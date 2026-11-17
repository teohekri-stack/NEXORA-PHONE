--[[---------------------------------------------------------------------------
    Nexora Phone - server bridge for QBCore (qb-core) and Qbox (qbx_core)
    Both frameworks share the same player object layout and event names, so
    one file covers them. Where Qbox offers a native export it is preferred.
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'qb' and Nexora.Framework ~= 'qbx' then return end

local Util = Nexora.Util
local isQbx = Nexora.Framework == 'qbx'
local QBCore = not isQbx and exports['qb-core']:GetCoreObject() or nil
local ACCOUNT = Config.Bank.account

local Bridge = { name = Nexora.Framework }
Nexora.Bridge = Bridge

local function getPlayer(src)
    if not src then return nil end

    if isQbx then
        return exports.qbx_core:GetPlayer(src)
    end

    return QBCore.Functions.GetPlayer(src)
end

local function getPlayerByCitizenId(citizenid)
    if isQbx then
        return exports.qbx_core:GetPlayerByCitizenId(citizenid)
    end

    return QBCore.Functions.GetPlayerByCitizenId(citizenid)
end

local function gradeLevel(grade)
    if type(grade) == 'table' then return tonumber(grade.level) or 0 end
    return tonumber(grade) or 0
end

-------------------------------------------------------------------------------
-- Identity
-------------------------------------------------------------------------------

function Bridge.IsLoaded(src)
    return getPlayer(src) ~= nil
end

---@return string? citizenid
function Bridge.GetIdentifier(src)
    local Player = getPlayer(src)
    return Player and Player.PlayerData.citizenid or nil
end

function Bridge.GetName(src)
    local Player = getPlayer(src)
    if not Player then return nil end

    local charinfo = Player.PlayerData.charinfo or {}
    local name = Util.Trim(('%s %s'):format(tostring(charinfo.firstname or ''), tostring(charinfo.lastname or '')))

    return name ~= '' and name or nil
end

---Sources of every player with a loaded character.
function Bridge.GetPlayers()
    local players = isQbx and exports.qbx_core:GetQBPlayers() or QBCore.Functions.GetQBPlayers()
    local list = {}

    for src in pairs(players or {}) do
        list[#list + 1] = tonumber(src)
    end

    return list
end

---@return integer? source of the online player owning this character
function Bridge.GetSource(identifier)
    local Player = getPlayerByCitizenId(identifier)
    return Player and Player.PlayerData.source or nil
end

---Turns text typed in the bank app into a citizenid, or nil.
function Bridge.ParseIdentifier(input)
    if type(input) ~= 'string' then return nil end

    local citizenid = Util.Trim(input):upper()
    if #citizenid < 3 or #citizenid > 50 or not citizenid:match('^%w+$') then return nil end

    return citizenid
end

-------------------------------------------------------------------------------
-- Jobs / gangs
-------------------------------------------------------------------------------

---Grade of the player in a job or gang, nil when they are not part of it.
function Bridge.GetGroupGrade(src, group)
    local Player = getPlayer(src)
    if not Player then return nil end

    local job, gang = Player.PlayerData.job, Player.PlayerData.gang

    if job and job.name == group then return gradeLevel(job.grade) end
    if gang and gang.name == group then return gradeLevel(gang.grade) end

    return nil
end

function Bridge.IsOnDuty(src, group)
    local Player = getPlayer(src)
    if not Player then return false end

    local job = Player.PlayerData.job
    if job and job.name == group then return job.onduty == true end

    return true -- gangs have no duty state
end

-------------------------------------------------------------------------------
-- Inventory
-------------------------------------------------------------------------------

function Bridge.HasItem(src, item)
    local count = Nexora.OxInventoryCount(src, item)
    if count then return count > 0 end

    local Player = getPlayer(src)
    if not Player then return false end

    if Player.Functions and Player.Functions.GetItemByName then
        local entry = Player.Functions.GetItemByName(item)
        return entry ~= nil and (tonumber(entry.amount or entry.count) or 1) > 0
    end

    if QBCore and QBCore.Functions.HasItem then
        return QBCore.Functions.HasItem(src, item, 1) == true
    end

    return false
end

-------------------------------------------------------------------------------
-- Money
-------------------------------------------------------------------------------

local function balanceOf(Player)
    local money = Player.PlayerData.money
    return math.floor(tonumber(money and money[ACCOUNT]) or 0)
end

function Bridge.GetBalance(src)
    local Player = getPlayer(src)
    return Player and balanceOf(Player) or 0
end

---Withdraws money. The balance check and the withdrawal happen without a
---yield in between, so two requests can never spend the same money.
---@return boolean success false when the balance is too low
function Bridge.RemoveMoney(src, amount, reason)
    local Player = getPlayer(src)
    if not Player or balanceOf(Player) < amount then return false end

    if Player.Functions and Player.Functions.RemoveMoney then
        return Player.Functions.RemoveMoney(ACCOUNT, amount, reason) == true
    end

    return exports.qbx_core:RemoveMoney(src, ACCOUNT, amount, reason) == true
end

---@return boolean success
function Bridge.AddMoney(src, amount, reason)
    local Player = getPlayer(src)
    if not Player then return false end

    if Player.Functions and Player.Functions.AddMoney then
        return Player.Functions.AddMoney(ACCOUNT, amount, reason) == true
    end

    return exports.qbx_core:AddMoney(src, ACCOUNT, amount, reason) == true
end

---Credits a character that is offline (players.money is a JSON text column).
---@return boolean success
function Bridge.DepositOffline(identifier, amount)
    return Nexora.JsonDeposit('players', 'money', 'citizenid', identifier, ACCOUNT, amount)
end

-------------------------------------------------------------------------------
-- Phone number stored by the framework (charinfo.phone)
-------------------------------------------------------------------------------

function Bridge.GetCharNumber(src)
    local Player = getPlayer(src)
    local charinfo = Player and Player.PlayerData.charinfo or nil

    return charinfo and charinfo.phone or nil
end

function Bridge.SetCharNumber(src, number)
    local Player = getPlayer(src)
    if not Player then return end

    if isQbx then
        local ok = pcall(function()
            exports.qbx_core:SetCharInfo(src, 'phone', number)
        end)
        if ok then return end
    end

    local charinfo = Player.PlayerData.charinfo or {}
    charinfo.phone = number
    Player.Functions.SetPlayerData('charinfo', charinfo)
end

---Owner of a number according to the framework's character table. Only a
---fallback for characters that never logged in since the phone was installed.
---@return string? citizenid
function Bridge.FindByCharNumber(number)
    return MySQL.scalar.await(
        "SELECT citizenid FROM players WHERE JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.phone')) = ? LIMIT 1",
        { number }
    )
end

-------------------------------------------------------------------------------
-- Offline characters
-------------------------------------------------------------------------------

function Bridge.CharacterExists(identifier)
    return MySQL.scalar.await('SELECT 1 FROM players WHERE citizenid = ? LIMIT 1', { identifier }) ~= nil
end

function Bridge.GetOfflineName(identifier)
    local charinfo = MySQL.scalar.await('SELECT charinfo FROM players WHERE citizenid = ? LIMIT 1', { identifier })
    if type(charinfo) ~= 'string' then return nil end

    local ok, data = pcall(json.decode, charinfo)
    if not ok or type(data) ~= 'table' then return nil end

    local name = Util.Trim(('%s %s'):format(tostring(data.firstname or ''), tostring(data.lastname or '')))
    return name ~= '' and name or nil
end

-------------------------------------------------------------------------------
-- Lifecycle
-------------------------------------------------------------------------------

AddEventHandler('QBCore:Server:PlayerLoaded', function(Player)
    local src = Player and Player.PlayerData and Player.PlayerData.source
    if src then Nexora.OnPlayerLoaded(src) end
end)

AddEventHandler('QBCore:Server:OnPlayerUnload', function(src)
    Nexora.OnPlayerUnloaded(src)
end)

AddEventHandler('QBCore:Server:OnJobUpdate', function(src)
    Nexora.OnGroupsChanged(src)
end)

AddEventHandler('QBCore:Server:OnGangUpdate', function(src)
    Nexora.OnGroupsChanged(src)
end)
