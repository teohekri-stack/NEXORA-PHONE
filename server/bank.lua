--[[---------------------------------------------------------------------------
    Nexora Phone - bank
    Balances are always read from the framework on the server. The client only
    ever sends "who" and "how much": the amount is validated here, and the
    withdrawal goes through Bridge.RemoveMoney, which refuses to overdraw.
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util
local DB = Nexora.DB
local Bridge = Nexora.Bridge

if type(Config.Bank.account) ~= 'string' or not Config.Bank.account:match('^[%a_]+$') then
    error('Config.Bank.account must be a money account name such as "bank"')
end

local function formatMoney(amount)
    return Config.Bank.currency .. Util.GroupDigits(amount)
end

---Finds who a transfer should go to.
---@param target any phone number or (when enabled and supported) a character id
---@return string? identifier
local function resolveRecipient(target)
    local number = Util.NormalizeNumber(target)

    if number then
        local identifier = Nexora.ResolveNumber(number)
        if identifier then return identifier end
    end

    if Config.Bank.allowCharacterId then
        local identifier = Bridge.ParseIdentifier(target)

        if identifier and (Bridge.GetSource(identifier) or Bridge.CharacterExists(identifier)) then
            return identifier
        end
    end

    return nil
end

---Display name of a character, online or offline.
local function nameOf(identifier)
    local src = Bridge.GetSource(identifier)

    if src then
        return Bridge.GetName(src) or identifier, src
    end

    return Bridge.GetOfflineName(identifier) or identifier, nil
end

---Pays the recipient, online or (when allowed) offline. The recipient is
---looked up again here because they may have logged in or out meanwhile.
---@return boolean credited, integer? source source when paid to an online player
local function credit(identifier, amount, label)
    local src = Bridge.GetSource(identifier)

    if src then
        return Bridge.AddMoney(src, amount, label) == true, src
    end

    if Config.Bank.allowOffline then
        return Bridge.DepositOffline(identifier, amount, label) == true, nil
    end

    return false, nil
end

---Gives money back to the sender after a failed transfer.
local function refund(session, total)
    local label = 'nexora-phone: transfer refund'
    local ok, done

    if Bridge.GetIdentifier(session.source) == session.identifier then
        ok, done = pcall(Bridge.AddMoney, session.source, total, label)
    else
        -- The sender left in the split second the transfer was running.
        ok, done = pcall(Bridge.DepositOffline, session.identifier, total, label)
    end

    if not ok or not done then
        Util.Warn(('REFUND FAILED for %s (%s): %s'):format(session.identifier, total, tostring(done)))
    end
end

---@param session NexoraSession
---@param target any
---@param amount integer already validated
---@param reason string already cleaned
---@return table result
local function performTransfer(session, target, amount, reason)
    local receiverId = resolveRecipient(target)

    if not receiverId then return { ok = false, error = 'unknown_recipient' } end
    if receiverId == session.identifier then return { ok = false, error = 'self' } end

    local fee = math.floor(amount * (Config.Bank.feePercent or 0) / 100 + 0.5)
    local total = amount + fee
    local label = 'nexora-phone: ' .. (reason ~= '' and reason or 'transfer')

    local receiverName, receiverSrc = nameOf(receiverId)

    if not receiverSrc and not Config.Bank.allowOffline then
        return { ok = false, error = 'recipient_offline' }
    end

    -- The sender must still be the character this session belongs to.
    if Bridge.GetIdentifier(session.source) ~= session.identifier then
        return { ok = false, error = 'not_ready' }
    end

    -- Withdraw first. The bridge checks the balance and removes the money in
    -- one step, so a second request can not spend the same money again.
    local removedOk, removed = pcall(Bridge.RemoveMoney, session.source, total, label)

    if not removedOk then
        Util.Warn(('withdrawal for %s failed: %s'):format(session.identifier, tostring(removed)))
        return { ok = false, error = 'internal' }
    end

    if not removed then
        return { ok = false, error = 'insufficient' }
    end

    -- From here on the sender's money is gone, so every failure - including
    -- an unexpected error inside the framework - has to give it back.
    local creditedOk, credited, creditedSrc = pcall(credit, receiverId, amount, label)

    if not creditedOk or not credited then
        if not creditedOk then
            Util.Warn(('deposit for %s failed: %s'):format(receiverId, tostring(credited)))
        end

        refund(session, total)
        return { ok = false, error = creditedOk and 'recipient_offline' or 'internal' }
    end

    receiverSrc = creditedSrc

    local balance = Bridge.GetBalance(session.source)
    session.lastTransfer = GetGameTimer()

    -- The money has moved; a failing log entry must not turn into an error.
    local logged, transactionId = pcall(DB.AddTransaction,
        session.identifier, session.name, receiverId, receiverName, amount, fee, reason)

    if not logged then
        Util.Warn(('could not log transfer %s -> %s (%s): %s'):format(
            session.identifier, receiverId, amount, tostring(transactionId)))
        transactionId = nil
    end

    local now = os.time()

    if receiverSrc and Nexora.PeekSession(receiverSrc) then
        TriggerClientEvent('nexora-phone:client:bankTransaction', receiverSrc, {
            id = transactionId,
            direction = 'in',
            name = session.name,
            amount = amount,
            fee = 0,
            reason = reason,
            ts = now,
            balance = Bridge.GetBalance(receiverSrc),
        })
    end

    Nexora.Notify(receiverId, {
        app = 'bank',
        title = locale('bank_title'),
        body = locale('bank_received', formatMoney(amount), session.name),
    })

    -- Hook for logging / integrations:
    -- (senderSource, senderIdentifier, receiverIdentifier, amount, fee, reason)
    TriggerEvent('nexora-phone:server:transfer', session.source, session.identifier, receiverId, amount, fee, reason)

    return {
        ok = true,
        balance = balance,
        transaction = {
            id = transactionId,
            direction = 'out',
            name = receiverName,
            amount = amount,
            fee = fee,
            reason = reason,
            ts = now,
        },
    }
end

-------------------------------------------------------------------------------
-- Callbacks
-------------------------------------------------------------------------------

Nexora.RegisterCallback('bank:overview', { app = 'bank' }, function(session)
    local rows = DB.GetTransactions(session.identifier, Config.Bank.historyLimit)
    local history = {}

    for i = 1, #rows do
        local row = rows[i]
        local outgoing = row.sender_id == session.identifier

        history[i] = {
            id = row.id,
            direction = outgoing and 'out' or 'in',
            name = outgoing and row.receiver_name or row.sender_name,
            amount = tonumber(row.amount) or 0,
            fee = outgoing and (tonumber(row.fee) or 0) or 0,
            reason = row.reason,
            ts = tonumber(row.ts),
        }
    end

    return {
        ok = true,
        balance = Bridge.GetBalance(session.source),
        name = session.name,
        history = history,
    }
end)

-- Shows who a number / character id belongs to before the player confirms.
Nexora.RegisterCallback('bank:lookup', { app = 'bank' }, function(session, target)
    local identifier = resolveRecipient(target)

    if not identifier then return { ok = false, error = 'unknown_recipient' } end
    if identifier == session.identifier then return { ok = false, error = 'self' } end

    local name, src = nameOf(identifier)

    if not src and not Config.Bank.allowOffline then
        return { ok = false, error = 'recipient_offline' }
    end

    return { ok = true, name = name }
end)

Nexora.RegisterCallback('bank:transfer', { app = 'bank', limit = 'transfer' }, function(session, target, amount, reason)
    if session.transferring then return { ok = false, error = 'busy' } end

    local cooldown = (Config.Bank.cooldown or 0) * 1000
    if session.lastTransfer and GetGameTimer() - session.lastTransfer < cooldown then
        return { ok = false, error = 'cooldown' }
    end

    -- Whole, positive amounts within the configured range only.
    amount = Util.ToInteger(amount, math.max(1, Config.Bank.minTransfer), Config.Bank.maxTransfer)
    if not amount then return { ok = false, error = 'invalid_amount' } end

    reason = Util.CleanText(reason == nil and '' or reason, Config.Bank.reasonMaxLength)
    if not reason then return { ok = false, error = 'invalid' } end

    session.transferring = true
    local ok, result = pcall(performTransfer, session, target, amount, reason)
    session.transferring = nil

    if not ok then
        Util.Warn(('transfer by %s failed: %s'):format(session.identifier, tostring(result)))
        return { ok = false, error = 'internal' }
    end

    return result
end)
