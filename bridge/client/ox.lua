--[[---------------------------------------------------------------------------
    Nexora Phone - client bridge for ox_core
    ox_core publishes player state through state bags, so no library import
    is needed on the client.
-----------------------------------------------------------------------------]]

if Nexora.Framework ~= 'ox' then return end

local Bridge = { name = 'ox' }
Nexora.Bridge = Bridge

function Bridge.IsDead()
    return LocalPlayer.state.isDead == true
end

function Bridge.IsCuffed()
    return false
end

---@param kind 'info'|'success'|'error'
function Bridge.Notify(message, kind)
    lib.notify({ description = message, type = kind == 'info' and 'inform' or kind })
end
