--[[---------------------------------------------------------------------------
    Nexora Phone - framework detection
    Decides which bridge (bridge/server/*.lua + bridge/client/*.lua) is used.
    Every bridge file starts with a guard and simply returns when it does not
    belong to the detected framework, so only one of them is ever active.

    Supported:  qb  (qb-core)      qbx (qbx_core / Qbox)
                esx (es_extended)  ox  (ox_core)
-----------------------------------------------------------------------------]]

local SUPPORTED = { qb = true, qbx = true, esx = true, ox = true }

local function isRunning(resource)
    local state = GetResourceState(resource)
    return state == 'started' or state == 'starting'
end

local function detect()
    local choice = Config.Framework

    if type(choice) == 'string' and choice:lower() ~= 'auto' then
        choice = choice:lower()
        return SUPPORTED[choice] and choice or nil
    end

    -- Qbox provides the "qb-core" name too, so it has to be checked first.
    if isRunning('qbx_core') then return 'qbx' end
    if isRunning('qb-core') then return 'qb' end
    if isRunning('es_extended') then return 'esx' end
    if isRunning('ox_core') then return 'ox' end

    return nil
end

---Name of the active framework: 'qb' | 'qbx' | 'esx' | 'ox' | nil
Nexora.Framework = detect()

if Nexora.Framework then
    Nexora.Util.Debug(('framework: %s'):format(Nexora.Framework))
else
    Nexora.Util.Warn(('No supported framework found (Config.Framework = "%s").'):format(tostring(Config.Framework)))
    Nexora.Util.Warn('Start qb-core, qbx_core, es_extended or ox_core BEFORE this resource in server.cfg.')
end

-------------------------------------------------------------------------------
-- Server-only helpers shared by several bridges
-------------------------------------------------------------------------------

if not IsDuplicityVersion() then return end

---Amount of an item a player carries according to ox_inventory, or nil when
---ox_inventory is not running (the bridge then asks the framework instead).
---@param src integer
---@param item string
---@return integer?
function Nexora.OxInventoryCount(src, item)
    if GetResourceState('ox_inventory') ~= 'started' then return nil end

    local ok, count = pcall(function()
        return exports.ox_inventory:Search(src, 'count', item)
    end)

    if not ok then return nil end

    return tonumber(count) or 0
end

---Adds `amount` to one numeric field of a JSON object kept in a text column
---(QBCore `players.money`, ESX `users.accounts`). The write is a
---compare-and-swap on the original value, so a concurrent change made by the
---framework is never overwritten - the deposit is retried or fails cleanly.
---Table and column names come from bridge code, never from players.
---@return boolean success
function Nexora.JsonDeposit(tableName, column, keyColumn, keyValue, field, amount)
    local selectQuery = ('SELECT `%s` FROM `%s` WHERE `%s` = ? LIMIT 1'):format(column, tableName, keyColumn)
    local updateQuery = ('UPDATE `%s` SET `%s` = ? WHERE `%s` = ? AND `%s` = ?'):format(tableName, column, keyColumn, column)

    for _ = 1, 3 do
        local raw = MySQL.scalar.await(selectQuery, { keyValue })
        if type(raw) ~= 'string' then return false end

        local ok, data = pcall(json.decode, raw)
        if not ok or type(data) ~= 'table' then return false end

        data[field] = (tonumber(data[field]) or 0) + amount

        local affected = MySQL.update.await(updateQuery, { json.encode(data), keyValue, raw })
        if (affected or 0) > 0 then return true end
    end

    return false
end
