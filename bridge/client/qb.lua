--[[---------------------------------------------------------------------------
    Nexora Phone - client bridge for QBCore (qb-core) and Qbox (qbx_core)
    The client only needs the framework for player state checks and for
    framework styled notifications; everything else comes from the server.
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'qb' and Nexora.Framework ~= 'qbx' then return end

local isQbx = Nexora.Framework == 'qbx'
local QBCore = not isQbx and exports['qb-core']:GetCoreObject() or nil

local Bridge = { name = Nexora.Framework }
Nexora.Bridge = Bridge

local function metadata()
    local ok, data = pcall(function()
        if isQbx then
            return exports.qbx_core:GetPlayerData()
        end
        return QBCore.Functions.GetPlayerData()
    end)

    if ok and type(data) == 'table' and type(data.metadata) == 'table' then
        return data.metadata
    end

    return {}
end

function Bridge.IsDead()
    local meta = metadata()
    return meta.isdead == true or meta.inlaststand == true
end

function Bridge.IsCuffed()
    return metadata().ishandcuffed == true
end

---@param kind 'info'|'success'|'error'
function Bridge.Notify(message, kind)
    if kind == 'info' or kind == nil then kind = 'primary' end

    if isQbx then
        exports.qbx_core:Notify(message, kind == 'primary' and 'inform' or kind)
    else
        QBCore.Functions.Notify(message, kind)
    end
end
