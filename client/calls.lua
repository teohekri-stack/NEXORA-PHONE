--[[---------------------------------------------------------------------------
    Nexora Phone - calls (client)
    Mirrors the call state the server decides on, drives the UI, the "phone
    at the ear" animation and - for voice resources that are controlled from
    the client - the voice channel.
-----------------------------------------------------------------------------]]

local State = Nexora.State

Nexora.Calls = {}
local Calls = Nexora.Calls

---@type { id: integer, number: string?, direction: 'in'|'out', state: 'ringing'|'active', anonymous: boolean }?
local current = nil
local watcher = nil

-------------------------------------------------------------------------------
-- Voice
-------------------------------------------------------------------------------

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

---pma-voice is placed in the call channel by the server. mumble-voip only
---has a client export, and custom voice scripts can listen to the event.
---@param channel integer 0 leaves the call
local function setVoiceChannel(channel)
    if voiceResource() == 'mumble-voip' then
        pcall(function()
            exports['mumble-voip']:SetCallChannel(channel)
        end)
    end

    -- Hook for other voice resources: (channel) - 0 means the call ended.
    TriggerEvent('nexora-phone:client:callChannel', channel)
end

-------------------------------------------------------------------------------
-- State helpers
-------------------------------------------------------------------------------

---A call exists (ringing or connected).
function Calls.IsActive()
    return current ~= nil
end

---The phone is at the player's ear (dialling out or connected).
function Calls.IsOnLine()
    return current ~= nil and (current.state == 'active' or current.direction == 'out')
end

local function setInCall(inCall)
    LocalPlayer.state:set('nexoraInCall', inCall, true)
end

---Keeps the call animation alive and ends the call when the player can no
---longer hold a phone. Runs only while a call exists.
local function startWatcher()
    local token = {}
    watcher = token

    CreateThread(function()
        while current and watcher == token do
            Wait(1000)

            if not current or watcher ~= token then break end

            if Nexora.IsBlocked() then
                Calls.End()
                break
            end

            Nexora.Phone.EnsureAnimation()
        end
    end)
end

local function clear()
    if not current then return end

    if current.state == 'active' then
        setVoiceChannel(0)
    end

    current = nil
    watcher = nil

    setInCall(false)
    Nexora.Phone.RefreshAnimation()
end

-------------------------------------------------------------------------------
-- Actions (called from the NUI callbacks)
-------------------------------------------------------------------------------

---@param number any
---@param anonymous boolean
---@return table result
function Calls.Start(number, anonymous)
    if current then return { ok = false, error = 'busy_self' } end

    local result = Nexora.Callback('call:start', number, anonymous == true)
    if not result.ok or type(result.call) ~= 'table' then return result end

    current = {
        id = result.call.id,
        number = result.call.number,
        direction = 'out',
        state = 'ringing',
        anonymous = result.call.anonymous == true,
    }

    setInCall(true)
    Nexora.Phone.RefreshAnimation()
    startWatcher()

    return result
end

---@return table result
function Calls.Answer()
    if not current or current.direction ~= 'in' or current.state ~= 'ringing' then
        return { ok = false, error = 'no_call' }
    end

    return Nexora.Callback('call:answer')
end

---Hangs up / declines / cancels. The server confirms with callEnded.
---@return table result
function Calls.End()
    if not current then return { ok = true } end

    return Nexora.Callback('call:end')
end

---Drops the local call state without asking the server (logout, restart).
function Calls.Reset()
    clear()
end

-------------------------------------------------------------------------------
-- Server events
-------------------------------------------------------------------------------

RegisterNetEvent('nexora-phone:client:callIncoming', function(data)
    if type(data) ~= 'table' or current then return end

    current = {
        id = data.id,
        number = data.number,
        direction = 'in',
        state = 'ringing',
        anonymous = data.anonymous == true,
    }

    startWatcher()

    Nexora.SendNUI('call:incoming', {
        id = data.id,
        number = data.number,
        anonymous = current.anonymous,
    })
end)

RegisterNetEvent('nexora-phone:client:callState', function(data)
    if type(data) ~= 'table' or not current or current.id ~= data.id then return end

    current.state = data.state

    if data.state == 'active' then
        setInCall(true)
        setVoiceChannel(tonumber(data.channel) or 0)
    end

    Nexora.Phone.RefreshAnimation()
    Nexora.SendNUI('call:state', { id = data.id, state = data.state })
end)

RegisterNetEvent('nexora-phone:client:callEnded', function(data)
    if type(data) ~= 'table' then return end

    if current and current.id == data.id then
        clear()
    end

    Nexora.SendNUI('call:ended', data)
end)
