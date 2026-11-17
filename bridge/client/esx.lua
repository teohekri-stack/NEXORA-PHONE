--[[---------------------------------------------------------------------------
    Nexora Phone - client bridge for ESX (es_extended)
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'esx' then return end

local ESX

do
    local ok, object = pcall(function()
        return exports['es_extended']:getSharedObject()
    end)

    if ok and object then
        ESX = object
    else
        TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
    end
end

local Bridge = { name = 'esx' }
Nexora.Bridge = Bridge

-- Not every ESX version keeps PlayerData.dead up to date, so the death
-- events are tracked as well.
local dead = false

AddEventHandler('esx:onPlayerDeath', function() dead = true end)
AddEventHandler('esx:onPlayerSpawn', function() dead = false end)
AddEventHandler('playerSpawned', function() dead = false end)

function Bridge.IsDead()
    if dead then return true end

    local data = ESX and (ESX.GetPlayerData and ESX.GetPlayerData() or ESX.PlayerData) or nil
    return type(data) == 'table' and data.dead == true
end

-- ESX has no shared "handcuffed" state; the generic checks in client/main.lua
-- (IsPedCuffed + state bags) cover esx_policejob and most cuff scripts.
function Bridge.IsCuffed()
    return false
end

---@param kind 'info'|'success'|'error'
function Bridge.Notify(message, kind)
    if ESX and ESX.ShowNotification then
        ESX.ShowNotification(message, kind or 'info')
    else
        lib.notify({ description = message, type = kind == 'info' and 'inform' or kind })
    end
end
