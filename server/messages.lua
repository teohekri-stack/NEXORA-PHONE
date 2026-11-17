--[[---------------------------------------------------------------------------
    Nexora Phone - SMS
    The sender of a message is always derived from the session of the player
    that made the request, never from anything the client sends, so a phone
    number cannot be spoofed.
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util
local DB = Nexora.DB

Nexora.Messages = {}
local Messages = Nexora.Messages

local KINDS = { text = true, image = true, location = true }

---Conversations are keyed by the other party: a phone number, or a short
---label for system senders created through the SendMessage export.
---@param value any
---@return string?
function Messages.NormaliseParty(value)
    local number = Util.NormalizeNumber(value)
    if number then return number end

    if type(value) ~= 'string' then return nil end

    local label = Util.CleanText(value, 20)
    if not label or label == '' or not label:match('^[%w _%-]+$') then return nil end

    return label
end

---Stores a message and pushes it to the receiver when they are online.
---@param sender string number or system label
---@param receiver string number
---@param body string
---@param kind string
---@param attachment string?
---@param senderSrc integer? source of the sending player, nil for exports
---@return table message
function Messages.Deliver(sender, receiver, body, kind, attachment, senderSrc)
    local id = DB.InsertMessage(sender, receiver, body, kind, attachment)

    local message = {
        id = id,
        from = sender,
        to = receiver,
        body = body,
        kind = kind,
        attachment = attachment,
        ts = os.time(),
        read = false,
        mine = false,
    }

    local target = Nexora.GetSessionByNumber(receiver)

    -- A phone in airplane mode picks the message up from the database later.
    if target and not target.settings.airplane then
        local payload = Util.Copy(message)
        payload.silent = not Nexora.IsReachable(target)
        TriggerClientEvent('nexora-phone:client:message', target.source, payload)
    end

    local outgoing = Util.Copy(message)
    outgoing.mine = true

    -- Sent on behalf of an online player by another resource: mirror it into
    -- their own conversation list as well.
    if not senderSrc then
        local origin = Nexora.GetSessionByNumber(sender)
        if origin then
            TriggerClientEvent('nexora-phone:client:message', origin.source, outgoing)
        end
    end

    -- Hook for logging / integrations: (senderSource?, message)
    TriggerEvent('nexora-phone:server:messageSent', senderSrc, message)

    return outgoing
end

---Validates and sends a message written by a player.
---@param session NexoraSession
---@return table result
function Messages.SendFromPlayer(session, target, body, kind, attachment)
    local number = Util.NormalizeNumber(target)
    if not number then return { ok = false, error = 'invalid_number' } end
    if number == session.number then return { ok = false, error = 'self' } end

    if kind == nil then kind = 'text' end
    if type(kind) ~= 'string' or not KINDS[kind] then
        return { ok = false, error = 'invalid' }
    end

    local text = Util.CleanText(body == nil and '' or body, Config.Messages.maxLength, true)
    if not text then return { ok = false, error = 'invalid' } end

    if kind == 'text' then
        if text == '' then return { ok = false, error = 'empty' } end
        attachment = nil
    elseif kind == 'image' then
        if not Config.Messages.allowImages then return { ok = false, error = 'not_allowed' } end
        if not Nexora.IsImageAllowed(session, attachment) then return { ok = false, error = 'invalid_image' } end
    else
        if not Config.Messages.allowLocation then return { ok = false, error = 'not_allowed' } end

        -- The position is read on the server; a client can not fake one.
        local ped = GetPlayerPed(session.source)
        if not ped or ped == 0 then return { ok = false, error = 'internal' } end

        local coords = GetEntityCoords(ped)
        attachment = ('%.2f,%.2f'):format(coords.x, coords.y)
    end

    local allowed, reason = Nexora.CanCommunicate(session)
    if not allowed then return { ok = false, error = reason } end

    local identifier, targetSrc = Nexora.ResolveNumber(number)
    if not identifier then return { ok = false, error = 'not_in_service' } end

    if not targetSrc and not Config.Messages.storeOffline then
        return { ok = false, error = 'unavailable' }
    end

    return { ok = true, message = Messages.Deliver(session.number, number, text, kind, attachment, session.source) }
end

-------------------------------------------------------------------------------
-- Callbacks
-------------------------------------------------------------------------------

Nexora.RegisterCallback('messages:conversations', { app = 'messages' }, function(session)
    local rows = DB.GetConversations(session.number)
    local unreadRows = DB.GetUnreadCounts(session.number)

    local unread, total = {}, 0
    for i = 1, #unreadRows do
        local count = tonumber(unreadRows[i].unread) or 0
        unread[unreadRows[i].sender] = count
        total = total + count
    end

    local conversations = {}
    for i = 1, #rows do
        local row = rows[i]
        local mine = row.sender == session.number
        local other = mine and row.receiver or row.sender

        conversations[#conversations + 1] = {
            number = other,
            unread = unread[other] or 0,
            last = {
                id = row.id,
                body = row.body,
                kind = row.kind,
                ts = tonumber(row.ts),
                mine = mine,
            },
        }
    end

    return { ok = true, conversations = conversations, unread = total }
end)

Nexora.RegisterCallback('messages:thread', { app = 'messages' }, function(session, other, beforeId)
    other = Messages.NormaliseParty(other)
    if not other then return { ok = false, error = 'invalid_number' } end

    if beforeId ~= nil then
        beforeId = Util.ToInteger(beforeId, 1)
        if not beforeId then return { ok = false, error = 'invalid' } end
    end

    local limit = Config.Messages.pageSize
    local rows = DB.GetThread(session.number, other, beforeId, limit + 1)

    local hasMore = #rows > limit
    if hasMore then rows[#rows] = nil end

    -- The UI wants the oldest message first.
    local messages, hadUnread = {}, false
    for i = #rows, 1, -1 do
        local row = rows[i]
        local mine = row.sender == session.number
        local read = Util.ToBool(row.is_read)

        if not mine and not read then hadUnread = true end

        messages[#messages + 1] = {
            id = row.id,
            from = row.sender,
            to = row.receiver,
            body = row.body,
            kind = row.kind,
            attachment = row.attachment,
            ts = tonumber(row.ts),
            read = read,
            mine = mine,
        }
    end

    if hadUnread then
        DB.MarkThreadRead(session.number, other)

        local sender = Nexora.GetSessionByNumber(other)
        if sender then
            TriggerClientEvent('nexora-phone:client:messagesRead', sender.source, session.number)
        end
    end

    return { ok = true, messages = messages, hasMore = hasMore }
end)

Nexora.RegisterCallback('messages:send', { app = 'messages', limit = 'message' }, function(session, target, body, kind, attachment)
    return Messages.SendFromPlayer(session, target, body, kind, attachment)
end)

Nexora.RegisterCallback('messages:read', { app = 'messages' }, function(session, other)
    other = Messages.NormaliseParty(other)
    if not other then return { ok = false, error = 'invalid_number' } end

    local changed = DB.MarkThreadRead(session.number, other)

    if changed and changed > 0 then
        local sender = Nexora.GetSessionByNumber(other)
        if sender then
            TriggerClientEvent('nexora-phone:client:messagesRead', sender.source, session.number)
        end
    end

    return { ok = true }
end)

Nexora.RegisterCallback('messages:deleteThread', { app = 'messages' }, function(session, other)
    other = Messages.NormaliseParty(other)
    if not other then return { ok = false, error = 'invalid_number' } end

    DB.DeleteThread(session.number, other)

    return { ok = true, unread = DB.GetUnreadTotal(session.number) }
end)

Nexora.RegisterCallback('messages:delete', { app = 'messages' }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local affected = DB.DeleteMessage(session.number, id)

    return { ok = (affected or 0) > 0 }
end)

-------------------------------------------------------------------------------
-- Exports
-------------------------------------------------------------------------------

---exports['nexora-phone']:SendMessage(from, to, message) -> boolean ok, any idOrError
---`from` is a phone number or a short system label such as "Dispatch",
---`to` is the receiving phone number.
exports('SendMessage', function(from, to, message)
    local receiver = Util.NormalizeNumber(to)
    if not receiver then return false, 'invalid_number' end

    local sender = Messages.NormaliseParty(from)
    if not sender then return false, 'invalid_sender' end
    if sender == receiver then return false, 'self' end

    local text = Util.CleanText(message, Config.Messages.maxLength, true)
    if not text or text == '' then return false, 'empty' end

    if not Nexora.ResolveNumber(receiver) then return false, 'not_in_service' end

    local ok, result = pcall(Messages.Deliver, sender, receiver, text, 'text', nil, nil)
    if not ok then
        Util.Warn(('SendMessage export failed: %s'):format(tostring(result)))
        return false, 'internal'
    end

    return true, result.id
end)
