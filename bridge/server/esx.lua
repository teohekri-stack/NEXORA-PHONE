--[[---------------------------------------------------------------------------
    Nexora Phone - server bridge for ESX (es_extended, Legacy 1.9+ recommended)
    The character identifier is xPlayer.identifier, which is unique per
    character when esx_multicharacter is used ("char1:license").
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'esx' then return end

local ACCOUNT = Config.Bank.account
local ESX

do
    local ok, object = pcall(function()
        return exports['es_extended']:getSharedObject()
    end)

    if ok and object then
        ESX = object
    else
        -- Very old es_extended versions only expose the object through an event.
        TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
    end

    if not ESX then
        error('could not get the ESX object - start es_extended before this resource')
    end
end

local Bridge = { name = 'esx' }
Nexora.Bridge = Bridge

local function getPlayer(src)
    return src and ESX.GetPlayerFromId(src) or nil
end

local function getJob(xPlayer)
    if xPlayer.job then return xPlayer.job end
    return xPlayer.getJob and xPlayer.getJob() or nil
end

-------------------------------------------------------------------------------
-- Identity
-------------------------------------------------------------------------------

function Bridge.IsLoaded(src)
    return getPlayer(src) ~= nil
end

function Bridge.GetIdentifier(src)
    local xPlayer = getPlayer(src)
    return xPlayer and xPlayer.identifier or nil
end

function Bridge.GetName(src)
    local xPlayer = getPlayer(src)
    if not xPlayer then return nil end

    local name = xPlayer.getName and xPlayer.getName() or xPlayer.name
    return type(name) == 'string' and name ~= '' and name or nil
end

function Bridge.GetPlayers()
    local list = {}

    if ESX.GetExtendedPlayers then
        for _, xPlayer in pairs(ESX.GetExtendedPlayers()) do
            list[#list + 1] = xPlayer.source
        end
    else
        for _, src in pairs(ESX.GetPlayers()) do
            list[#list + 1] = tonumber(src)
        end
    end

    return list
end

function Bridge.GetSource(identifier)
    local xPlayer = ESX.GetPlayerFromIdentifier(identifier)
    return xPlayer and xPlayer.source or nil
end

-- ESX identifiers ("char1:1a2b3c...") are not something a player can type,
-- so transfers on ESX always go to a phone number.
function Bridge.ParseIdentifier()
    return nil
end

-------------------------------------------------------------------------------
-- Jobs
-------------------------------------------------------------------------------

function Bridge.GetGroupGrade(src, group)
    local xPlayer = getPlayer(src)
    local job = xPlayer and getJob(xPlayer) or nil

    if job and job.name == group then
        return tonumber(job.grade) or 0
    end

    return nil
end

function Bridge.IsOnDuty(src, group)
    local xPlayer = getPlayer(src)
    local job = xPlayer and getJob(xPlayer) or nil

    -- job.onDuty only exists on newer ESX versions; older ones have no duty.
    if job and job.name == group and job.onDuty ~= nil then
        return job.onDuty == true
    end

    return job ~= nil
end

-------------------------------------------------------------------------------
-- Inventory
-------------------------------------------------------------------------------

function Bridge.HasItem(src, item)
    local count = Nexora.OxInventoryCount(src, item)
    if count then return count > 0 end

    local xPlayer = getPlayer(src)
    if not xPlayer then return false end

    local entry = xPlayer.getInventoryItem(item)
    return entry ~= nil and (tonumber(entry.count) or 0) > 0
end

-------------------------------------------------------------------------------
-- Money
-------------------------------------------------------------------------------

local function balanceOf(xPlayer)
    local account = xPlayer.getAccount(ACCOUNT)
    return math.floor(tonumber(account and account.money) or 0)
end

function Bridge.GetBalance(src)
    local xPlayer = getPlayer(src)
    return xPlayer and balanceOf(xPlayer) or 0
end

---No yield between the balance check and the withdrawal.
---@return boolean success false when the balance is too low
function Bridge.RemoveMoney(src, amount, reason)
    local xPlayer = getPlayer(src)
    if not xPlayer or balanceOf(xPlayer) < amount then return false end

    xPlayer.removeAccountMoney(ACCOUNT, amount, reason)
    return true
end

function Bridge.AddMoney(src, amount, reason)
    local xPlayer = getPlayer(src)
    if not xPlayer or not xPlayer.getAccount(ACCOUNT) then return false end

    xPlayer.addAccountMoney(ACCOUNT, amount, reason)
    return true
end

---Credits a character that is offline (users.accounts is a JSON text column).
function Bridge.DepositOffline(identifier, amount)
    return Nexora.JsonDeposit('users', 'accounts', 'identifier', identifier, ACCOUNT, amount)
end

-------------------------------------------------------------------------------
-- Phone number stored by the framework
--   ESX has no phone number of its own. On versions with player metadata the
--   number is mirrored into the "phoneNumber" meta key so other resources
--   can read it with xPlayer.getMeta('phoneNumber').
-------------------------------------------------------------------------------

function Bridge.GetCharNumber(src)
    local xPlayer = getPlayer(src)
    if not xPlayer or not xPlayer.getMeta then return nil end

    local ok, value = pcall(xPlayer.getMeta, 'phoneNumber')
    return ok and value or nil
end

function Bridge.SetCharNumber(src, number)
    local xPlayer = getPlayer(src)
    if not xPlayer or not xPlayer.setMeta then return end

    pcall(xPlayer.setMeta, 'phoneNumber', number)
end

-------------------------------------------------------------------------------
-- Offline characters
-------------------------------------------------------------------------------

function Bridge.CharacterExists(identifier)
    return MySQL.scalar.await('SELECT 1 FROM users WHERE identifier = ? LIMIT 1', { identifier }) ~= nil
end

function Bridge.GetOfflineName(identifier)
    -- firstname / lastname are added by esx_identity and may not exist.
    local ok, row = pcall(MySQL.single.await,
        'SELECT firstname, lastname FROM users WHERE identifier = ? LIMIT 1', { identifier })

    if not ok or not row then return nil end

    local name = Nexora.Util.Trim(('%s %s'):format(tostring(row.firstname or ''), tostring(row.lastname or '')))
    return name ~= '' and name or nil
end

-------------------------------------------------------------------------------
-- Lifecycle
-------------------------------------------------------------------------------

AddEventHandler('esx:playerLoaded', function(playerId)
    Nexora.OnPlayerLoaded(playerId)
end)

-- Fired for a real disconnect and for a character logout (multicharacter).
AddEventHandler('esx:playerDropped', function(playerId)
    Nexora.OnPlayerUnloaded(playerId)
end)

AddEventHandler('esx:playerLogout', function(playerId)
    Nexora.OnPlayerUnloaded(playerId)
end)

AddEventHandler('esx:setJob', function(playerId)
    Nexora.OnGroupsChanged(playerId)
end)
