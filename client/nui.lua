--[[---------------------------------------------------------------------------
    Nexora Phone - NUI callbacks
    The web UI talks to Lua through a handful of callbacks. Anything that
    needs data goes through "request", a thin proxy to the server callbacks
    (which do all validation), so no game logic is duplicated here.
-----------------------------------------------------------------------------]]

local State = Nexora.State

-- Server callbacks the UI may call through the "request" proxy.
local REQUESTS = {
    ['messages:conversations'] = true,
    ['messages:thread'] = true,
    ['messages:send'] = true,
    ['messages:read'] = true,
    ['messages:deleteThread'] = true,
    ['messages:delete'] = true,
    ['contacts:list'] = true,
    ['contacts:add'] = true,
    ['contacts:update'] = true,
    ['contacts:delete'] = true,
    ['notes:list'] = true,
    ['notes:save'] = true,
    ['notes:delete'] = true,
    ['gallery:list'] = true,
    ['gallery:add'] = true,
    ['gallery:saveFromMessage'] = true,
    ['gallery:delete'] = true,
    ['settings:set'] = true,
    ['settings:reset'] = true,
    ['notifications:dismiss'] = true,
    ['notifications:clear'] = true,
    ['clock:saveAlarms'] = true,
    ['bank:overview'] = true,
    ['bank:lookup'] = true,
    ['bank:transfer'] = true,
    ['call:history'] = true,
    ['call:delete'] = true,
    ['call:clear'] = true,
}

local MAX_ARGS = 6

-------------------------------------------------------------------------------
-- Lifecycle
-------------------------------------------------------------------------------

RegisterNUICallback('ready', function(_, cb)
    Nexora.OnNuiReady()
    cb({ ok = true })
end)

RegisterNUICallback('close', function(_, cb)
    Nexora.Close()
    cb({ ok = true })
end)

-- A text field got / lost focus. While typing the game must not receive any
-- keyboard input (otherwise "t" opens the chat, "w" walks, ...).
RegisterNUICallback('inputFocus', function(data, cb)
    State.typing = type(data) == 'table' and data.focused == true

    if State.open and not State.camera and Config.KeepInput then
        SetNuiFocusKeepInput(not State.typing)
    end

    cb({ ok = true })
end)

-------------------------------------------------------------------------------
-- Server proxy
-------------------------------------------------------------------------------

-- data = { name = 'messages:send', args = { ... }, n = <argument count> }
RegisterNUICallback('request', function(data, cb)
    local name = type(data) == 'table' and data.name or nil

    if type(name) ~= 'string' or not REQUESTS[name] then
        cb({ ok = false, error = 'invalid' })
        return
    end

    if not State.ready then
        cb({ ok = false, error = 'not_ready' })
        return
    end

    local args = type(data.args) == 'table' and data.args or {}

    -- The count is sent explicitly because JSON nulls leave holes in the table.
    local count = math.floor(tonumber(data.n) or #args)
    if count < 0 then count = 0 end
    if count > MAX_ARGS then count = MAX_ARGS end

    cb(Nexora.Callback(name, table.unpack(args, 1, count)))
end)

-------------------------------------------------------------------------------
-- Calls
-------------------------------------------------------------------------------

RegisterNUICallback('call:start', function(data, cb)
    if type(data) ~= 'table' then
        cb({ ok = false, error = 'invalid' })
        return
    end

    cb(Nexora.Calls.Start(data.number, data.anonymous == true))
end)

RegisterNUICallback('call:answer', function(_, cb)
    cb(Nexora.Calls.Answer())
end)

RegisterNUICallback('call:end', function(_, cb)
    cb(Nexora.Calls.End())
end)

-------------------------------------------------------------------------------
-- Camera
-------------------------------------------------------------------------------

RegisterNUICallback('camera:open', function(_, cb)
    cb(Nexora.Camera.Start())
end)

-------------------------------------------------------------------------------
-- Misc
-------------------------------------------------------------------------------

-- Marks a location shared in a message on the map.
RegisterNUICallback('waypoint', function(data, cb)
    local x = type(data) == 'table' and tonumber(data.x) or nil
    local y = type(data) == 'table' and tonumber(data.y) or nil

    if not x or not y or x ~= x or y ~= y or math.abs(x) > 12000.0 or math.abs(y) > 12000.0 then
        cb({ ok = false, error = 'invalid' })
        return
    end

    SetNewWaypoint(x + 0.0, y + 0.0)
    Nexora.Notify(locale('waypoint_set'), 'success')

    cb({ ok = true })
end)

-- The UI reports whether any alarm is enabled, so the game clock only has to
-- be forwarded while the phone is closed when it is actually needed.
RegisterNUICallback('alarms:active', function(data, cb)
    State.alarmsActive = type(data) == 'table' and data.active == true
    cb({ ok = true })
end)

-- Confirmation through ox_lib (only used when Config.UseOxLibDialogs is on).
RegisterNUICallback('dialog:confirm', function(data, cb)
    local header = type(data) == 'table' and type(data.title) == 'string' and data.title or Config.Brand.name
    local content = type(data) == 'table' and type(data.message) == 'string' and data.message or ''

    local answer = lib.alertDialog({
        header = header,
        content = content,
        centered = true,
        cancel = true,
    })

    -- ox_lib gives the NUI focus back to the game when its dialog closes.
    if State.open and not State.camera then
        SetNuiFocus(true, true)
        SetNuiFocusKeepInput(Config.KeepInput == true and not State.typing)
    end

    cb({ ok = true, confirmed = answer == 'confirm' })
end)

RegisterNUICallback('clipboard', function(data, cb)
    local text = type(data) == 'table' and data.text or nil

    if type(text) ~= 'string' or #text > 2048 then
        cb({ ok = false, error = 'invalid' })
        return
    end

    lib.setClipboard(text)
    cb({ ok = true })
end)
