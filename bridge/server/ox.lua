--[[---------------------------------------------------------------------------
    Nexora Phone - server bridge for ox_core
    The character identifier is the charId (stored as text). Money lives in
    the character's default ox_core account, whose balance operations are
    atomic in the database, so they are used as-is (no overdraw allowed).
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'ox' then return end

local Util = Nexora.Util

local loaded, Ox = pcall(require, '@ox_core.lib.init')

if not loaded or type(Ox) ~= 'table' then
    error(('could not load the ox_core library (%s) - start ox_core before this resource'):format(tostring(Ox)))
end

local Bridge = { name = 'ox' }
Nexora.Bridge = Bridge

---Player object, only when a character is active.
local function getPlayer(src)
    if not src then return nil end

    local ok, player = pcall(Ox.GetPlayer, src)
    if not ok or not player or not player.charId then return nil end

    return player
end

local function accountOf(charId)
    if not charId then return nil end

    local ok, account = pcall(Ox.GetCharacterAccount, charId)
    if not ok or not account then return nil end

    return account
end

local function toIdentifier(charId)
    return ('%d'):format(charId)
end

-------------------------------------------------------------------------------
-- Identity
-------------------------------------------------------------------------------

function Bridge.IsLoaded(src)
    return getPlayer(src) ~= nil
end

function Bridge.GetIdentifier(src)
    local player = getPlayer(src)
    return player and toIdentifier(player.charId) or nil
end

function Bridge.GetName(src)
    local player = getPlayer(src)
    if not player then return nil end

    local ok, name = pcall(player.get, 'name')
    if ok and type(name) == 'string' and name ~= '' then return name end

    local okFirst, first = pcall(player.get, 'firstName')
    local okLast, last = pcall(player.get, 'lastName')

    name = Util.Trim(('%s %s'):format(okFirst and tostring(first or '') or '', okLast and tostring(last or '') or ''))
    return name ~= '' and name or nil
end

function Bridge.GetPlayers()
    local list = {}
    local ok, players = pcall(Ox.GetPlayers)

    if ok and type(players) == 'table' then
        for i = 1, #players do
            if players[i].charId then
                list[#list + 1] = players[i].source
            end
        end
    end

    return list
end

function Bridge.GetSource(identifier)
    local charId = tonumber(identifier)
    if not charId then return nil end

    local ok, player = pcall(Ox.GetPlayerFromFilter, { charId = charId })
    return ok and player and player.source or nil
end

-- Transfers on ox_core always go to a phone number.
function Bridge.ParseIdentifier()
    return nil
end

-------------------------------------------------------------------------------
-- Groups
-------------------------------------------------------------------------------

function Bridge.GetGroupGrade(src, group)
    local player = getPlayer(src)
    if not player then return nil end

    local ok, grade = pcall(player.getGroup, group)
    return ok and tonumber(grade) or nil
end

---On duty = the group is the character's active group.
function Bridge.IsOnDuty(src, group)
    local player = getPlayer(src)
    if not player then return false end

    local ok, active = pcall(player.get, 'activeGroup')
    return ok and active == group
end

-------------------------------------------------------------------------------
-- Inventory (ox_core always runs with ox_inventory)
-------------------------------------------------------------------------------

function Bridge.HasItem(src, item)
    return (Nexora.OxInventoryCount(src, item) or 0) > 0
end

-------------------------------------------------------------------------------
-- Money
-------------------------------------------------------------------------------

function Bridge.GetBalance(src)
    local player = getPlayer(src)
    local account = player and accountOf(player.charId) or nil
    if not account then return 0 end

    local ok, balance = pcall(account.get, 'balance')
    return ok and math.floor(tonumber(balance) or 0) or 0
end

---@return boolean success false when the balance is too low
function Bridge.RemoveMoney(src, amount, reason)
    local player = getPlayer(src)
    local account = player and accountOf(player.charId) or nil
    if not account then return false end

    local ok, result = pcall(account.removeBalance, { amount = amount, message = reason, overdraw = false })
    return ok and type(result) == 'table' and result.success == true
end

local function deposit(charId, amount, reason)
    local account = accountOf(charId)
    if not account then return false end

    local ok, result = pcall(account.addBalance, { amount = amount, message = reason })
    return ok and type(result) == 'table' and result.success == true
end

function Bridge.AddMoney(src, amount, reason)
    local player = getPlayer(src)
    return player ~= nil and deposit(player.charId, amount, reason)
end

---ox_core accounts live in the database, so this is safe for offline characters.
function Bridge.DepositOffline(identifier, amount, reason)
    return deposit(tonumber(identifier), amount, reason or 'nexora-phone: transfer')
end

-------------------------------------------------------------------------------
-- Phone number stored by the framework (characters.phoneNumber)
-------------------------------------------------------------------------------

function Bridge.GetCharNumber(src)
    local player = getPlayer(src)
    if not player then return nil end

    local ok, value = pcall(player.get, 'phoneNumber')
    return ok and value or nil
end

function Bridge.SetCharNumber(src, number)
    local player = getPlayer(src)
    if not player then return end

    local ok, err = pcall(MySQL.update.await,
        'UPDATE characters SET phoneNumber = ? WHERE charId = ?', { number, player.charId })

    if not ok then
        Util.Debug(('could not write characters.phoneNumber: %s'):format(tostring(err)))
        return
    end

    pcall(player.set, 'phoneNumber', number, true)
end

function Bridge.FindByCharNumber(number)
    local ok, charId = pcall(MySQL.scalar.await,
        'SELECT charId FROM characters WHERE phoneNumber = ? LIMIT 1', { number })

    return ok and charId and toIdentifier(charId) or nil
end

-------------------------------------------------------------------------------
-- Offline characters
-------------------------------------------------------------------------------

function Bridge.CharacterExists(identifier)
    local charId = tonumber(identifier)
    if not charId then return false end

    return MySQL.scalar.await('SELECT 1 FROM characters WHERE charId = ? LIMIT 1', { charId }) ~= nil
end

function Bridge.GetOfflineName(identifier)
    local charId = tonumber(identifier)
    if not charId then return nil end

    local row = MySQL.single.await('SELECT firstName, lastName FROM characters WHERE charId = ? LIMIT 1', { charId })
    if not row then return nil end

    local name = Util.Trim(('%s %s'):format(tostring(row.firstName or ''), tostring(row.lastName or '')))
    return name ~= '' and name or nil
end

-------------------------------------------------------------------------------
-- Lifecycle
-------------------------------------------------------------------------------

AddEventHandler('ox:playerLoaded', function(playerId)
    Nexora.OnPlayerLoaded(playerId)
end)

AddEventHandler('ox:playerLogout', function(playerId)
    Nexora.OnPlayerUnloaded(playerId)
end)

AddEventHandler('ox:setGroup', function(playerId)
    Nexora.OnGroupsChanged(playerId)
end)

AddEventHandler('ox:setActiveGroup', function(playerId)
    Nexora.OnGroupsChanged(playerId)
end)
