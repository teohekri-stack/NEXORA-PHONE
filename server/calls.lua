--[[---------------------------------------------------------------------------
    Nexora Phone - calls
    A small state machine that lives entirely on the server:
        ringing -> active -> ended
    Clients only ever ask to start / answer / end "their" call; who is on the
    other side is decided here.
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util
local DB = Nexora.DB

Nexora.Calls = {}
local Calls = Nexora.Calls

---@class NexoraCall
---@field id integer
---@field caller integer source
---@field receiver integer source
---@field callerNumber string
---@field receiverNumber string
---@field receiverId string
---@field anonymous boolean
---@field state 'ringing'|'active'
---@field answeredAt integer?

local Active = {}   ---@type table<integer, NexoraCall>
local nextId = 0

-------------------------------------------------------------------------------
-- Voice
-------------------------------------------------------------------------------

---Name of the running voice resource, or nil when calls are text-only.
local function voiceResource()
    local mode = Config.Calls.voice

    if mode == 'none' then return nil end

    if mode == 'auto' then
        if GetResourceState('pma-voice') == 'started' then return 'pma-voice' end
        if GetResourceState('mumble-voip') == 'started' then return 'mumble-voip' end
        return nil
    end

    return GetResourceState(mode) == 'started' and mode or nil
end

---pma-voice lets the server place a player in a call channel, which keeps the
---channel id out of client hands. mumble-voip is handled by client/calls.lua.
local function setVoiceChannel(src, channel)
    if voiceResource() ~= 'pma-voice' then return end

    local ok, err = pcall(function()
        exports['pma-voice']:setPlayerCall(src, channel)
    end)

    if not ok then
        Util.Debug(('pma-voice setPlayerCall failed: %s'):format(tostring(err)))
    end
end

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

---Name a number has in someone's address book, or the formatted number.
---@param session NexoraSession? owner of the address book
---@param number string
local function displayName(session, number)
    if session then
        for i = 1, #session.contacts do
            if session.contacts[i].number == number then
                return session.contacts[i].name
            end
        end
    end
    return Util.FormatNumber(number)
end

---Logs a call that never rang and tells the receiver they missed it.
local function logUnanswered(callerNumber, receiverNumber, receiverId, anonymous)
    pcall(DB.InsertCall, callerNumber, receiverNumber, 'missed', anonymous, 0)

    local who = anonymous and locale('unknown_caller')
        or displayName(Nexora.GetSessionByIdentifier(receiverId), callerNumber)

    Nexora.Notify(receiverId, {
        app = 'phone',
        title = locale('missed_call'),
        body = locale('missed_call_from', who),
    })
end

---Ends a call, whatever state it is in.
---@param id integer
---@param reason 'hangup'|'timeout'|'disconnect'|'limit'
---@param bySrc? integer player that caused the end
function Calls.End(id, reason, bySrc)
    local call = Active[id]
    if not call then return end

    Active[id] = nil

    local caller = Nexora.PeekSession(call.caller)
    local receiver = Nexora.PeekSession(call.receiver)

    if caller and caller.call == id then caller.call = nil else caller = nil end
    if receiver and receiver.call == id then receiver.call = nil else receiver = nil end

    local status, duration = 'missed', 0

    if call.state == 'active' then
        status = 'answered'
        duration = math.max(0, os.time() - (call.answeredAt or os.time()))
        setVoiceChannel(call.caller, 0)
        setVoiceChannel(call.receiver, 0)
    elseif reason == 'hangup' and bySrc == call.receiver then
        status = 'declined'
    elseif bySrc == call.caller then
        status = 'cancelled'
    end

    local payload = { id = id, status = status, reason = reason, duration = duration }

    if caller then TriggerClientEvent('nexora-phone:client:callEnded', caller.source, payload) end
    if receiver then TriggerClientEvent('nexora-phone:client:callEnded', receiver.source, payload) end

    local ok, err = pcall(DB.InsertCall, call.callerNumber, call.receiverNumber, status, call.anonymous, duration)
    if not ok then
        Util.Warn(('could not store call log: %s'):format(tostring(err)))
    end

    if status == 'missed' or status == 'cancelled' then
        local who = call.anonymous and locale('unknown_caller') or displayName(receiver, call.callerNumber)

        Nexora.Notify(call.receiverId, {
            app = 'phone',
            title = locale('missed_call'),
            body = locale('missed_call_from', who),
        })
    end

    -- Hook for logging / integrations: (callId, status, durationSeconds, callerNumber, receiverNumber)
    TriggerEvent('nexora-phone:server:callEnded', id, status, duration, call.callerNumber, call.receiverNumber)
end

---Called by the session manager when a player logs out, switches character
---or drops while being part of a call.
---@param session NexoraSession
function Calls.HandleUnload(session)
    if session.call then
        Calls.End(session.call, 'disconnect', session.source)
    end
end

-------------------------------------------------------------------------------
-- Callbacks
-------------------------------------------------------------------------------

Nexora.RegisterCallback('call:start', { app = 'phone', limit = 'call' }, function(session, target, anonymous)
    if session.call then return { ok = false, error = 'busy_self' } end

    local number = Util.NormalizeNumber(target)
    if not number then return { ok = false, error = 'invalid_number' } end
    if number == session.number then return { ok = false, error = 'self' } end

    local allowed, reason = Nexora.CanCommunicate(session)
    if not allowed then return { ok = false, error = reason } end

    local hidden = Config.Calls.allowAnonymous
        and (anonymous == true or session.settings.hideCallerId == true)
        or false

    local identifier, targetSrc = Nexora.ResolveNumber(number)
    if not identifier then return { ok = false, error = 'not_in_service' } end

    -- The lookup above may have yielded: make sure nothing changed meanwhile.
    if session.call then return { ok = false, error = 'busy_self' } end

    local target = targetSrc and Nexora.PeekSession(targetSrc) or nil

    if not target or target.settings.doNotDisturb or not Nexora.IsReachable(target) then
        logUnanswered(session.number, number, identifier, hidden)
        return { ok = false, error = 'unavailable' }
    end

    if target.call then
        logUnanswered(session.number, number, identifier, hidden)
        return { ok = false, error = 'busy' }
    end

    nextId = nextId + 1

    local call = {
        id = nextId,
        caller = session.source,
        receiver = target.source,
        callerNumber = session.number,
        receiverNumber = number,
        receiverId = identifier,
        anonymous = hidden,
        state = 'ringing',
    }

    Active[call.id] = call
    session.call = call.id
    target.call = call.id

    TriggerClientEvent('nexora-phone:client:callIncoming', target.source, {
        id = call.id,
        number = (not hidden) and session.number or nil,
        anonymous = hidden,
    })

    SetTimeout(Config.Calls.ringTimeout * 1000, function()
        local current = Active[call.id]
        if current == call and current.state == 'ringing' then
            Calls.End(call.id, 'timeout')
        end
    end)

    -- Hook for logging / integrations: (callerSource, receiverSource, callId)
    TriggerEvent('nexora-phone:server:callStarted', session.source, target.source, call.id)

    return { ok = true, call = { id = call.id, number = number, anonymous = hidden } }
end)

Nexora.RegisterCallback('call:answer', { app = 'phone' }, function(session)
    local call = session.call and Active[session.call] or nil

    if not call or call.state ~= 'ringing' or call.receiver ~= session.source then
        return { ok = false, error = 'no_call' }
    end

    call.state = 'active'
    call.answeredAt = os.time()

    setVoiceChannel(call.caller, call.id)
    setVoiceChannel(call.receiver, call.id)

    local payload = { id = call.id, state = 'active', channel = call.id }

    TriggerClientEvent('nexora-phone:client:callState', call.caller, payload)
    TriggerClientEvent('nexora-phone:client:callState', call.receiver, payload)

    if Config.Calls.maxDuration > 0 then
        SetTimeout(Config.Calls.maxDuration * 1000, function()
            if Active[call.id] == call then
                Calls.End(call.id, 'limit')
            end
        end)
    end

    return { ok = true }
end)

-- Hanging up must always work, even when the phone item was lost mid-call.
Nexora.RegisterCallback('call:end', { phone = false }, function(session)
    if session.call then
        Calls.End(session.call, 'hangup', session.source)
    end

    return { ok = true }
end)

Nexora.RegisterCallback('call:history', { app = 'phone' }, function(session)
    local rows = DB.GetCalls(session.number, Config.Calls.historyLimit)
    local calls = {}

    for i = 1, #rows do
        local row = rows[i]
        local outgoing = row.caller == session.number
        local hidden = Util.ToBool(row.anonymous) and not outgoing

        calls[#calls + 1] = {
            id = row.id,
            direction = outgoing and 'out' or 'in',
            -- The number of an anonymous caller never leaves the server.
            number = outgoing and row.receiver or ((not hidden) and row.caller or nil),
            anonymous = hidden,
            status = row.status,
            duration = tonumber(row.duration) or 0,
            ts = tonumber(row.ts),
        }
    end

    return { ok = true, calls = calls }
end)

Nexora.RegisterCallback('call:delete', { app = 'phone' }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local affected = DB.DeleteCall(session.number, id)

    return { ok = (affected or 0) > 0 }
end)

Nexora.RegisterCallback('call:clear', { app = 'phone' }, function(session)
    DB.ClearCalls(session.number)
    return { ok = true }
end)

-------------------------------------------------------------------------------
-- Exports
-------------------------------------------------------------------------------

---exports['nexora-phone']:IsInCall(source) -> boolean
exports('IsInCall', function(src)
    local session = Nexora.PeekSession(tonumber(src) or -1)
    return session ~= nil and session.call ~= nil
end)

---exports['nexora-phone']:EndCall(source) -> boolean
---Force-ends the call a player is part of (jail, death, admin tools, ...).
exports('EndCall', function(src)
    local session = Nexora.PeekSession(tonumber(src) or -1)
    if not session or not session.call then return false end

    Calls.End(session.call, 'disconnect', session.source)
    return true
end)
