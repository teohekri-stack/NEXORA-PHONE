--[[---------------------------------------------------------------------------
    Nexora Phone - client core
    State, opening / closing, the keybind, server events and the client
    exports. Framework specifics live in bridge/client/*.lua; the character
    lifecycle is driven by the server (nexora-phone:client:loaded/unloaded),
    so this file is identical for every framework.
-----------------------------------------------------------------------------]]

local Util = Nexora.Util
local Bridge = Nexora.Bridge

lib.locale(Config.Locale)

-------------------------------------------------------------------------------
-- State
-------------------------------------------------------------------------------

---@class NexoraClientState
Nexora.State = {
    nuiReady = false,       -- the web page finished loading
    ready = false,          -- character data received from the server
    open = false,           -- phone UI visible and focused
    opening = false,        -- waiting for the server to allow opening
    typing = false,         -- a text field inside the phone has focus
    camera = false,         -- viewfinder active
    number = nil,           ---@type string?
    apps = {},              ---@type string[]
    battery = 100.0,
    charging = false,
    alarmsActive = false,   -- at least one alarm is enabled
    bootstrap = nil,        ---@type table? last bootstrap payload
}

local State = Nexora.State

-------------------------------------------------------------------------------
-- NUI messaging
-------------------------------------------------------------------------------

local queue = {}

---Sends a message to the web UI. Messages sent before the page has loaded
---are queued and delivered as soon as it reports ready.
---@param action string
---@param data? any
function Nexora.SendNUI(action, data)
    if not State.nuiReady then
        queue[#queue + 1] = { action = action, data = data }
        return
    end

    SendNUIMessage({ action = action, data = data })
end

---Static configuration the UI needs. Sent once per page load.
local function buildUiConfig()
    local apps = {}

    for i = 1, #Config.Apps do
        local app = Config.Apps[i]
        if app.enabled ~= false then
            apps[#apps + 1] = { id = app.id, label = app.label, dock = app.dock == true }
        end
    end

    local framework = Nexora.Framework

    return {
        resource = Nexora.Resource,
        framework = framework,
        debug = Config.Debug,
        oxDialogs = Config.UseOxLibDialogs == true,
        brand = Config.Brand,
        apps = apps,
        defaults = Config.Defaults,
        wallpapers = Config.Wallpapers,
        allowCustomWallpaper = Config.AllowCustomWallpaper,
        accents = Config.Accents,
        frames = Config.Frames,
        position = Config.Position,
        sounds = Config.Sounds,
        clockSource = Config.ClockSource,
        openKey = Config.OpenKey,
        keepInput = Config.KeepInput,
        number = {
            groups = Config.PhoneNumber.displayGroups,
            min = Config.PhoneNumber.minLength,
            max = Config.PhoneNumber.maxLength,
        },
        messages = {
            maxLength = Config.Messages.maxLength,
            allowImages = Config.Messages.allowImages,
            allowLocation = Config.Messages.allowLocation,
        },
        calls = {
            allowAnonymous = Config.Calls.allowAnonymous,
        },
        bank = {
            currency = Config.Bank.currency,
            min = Config.Bank.minTransfer,
            max = Config.Bank.maxTransfer,
            feePercent = Config.Bank.feePercent,
            reasonMaxLength = Config.Bank.reasonMaxLength,
            allowCharacterId = Config.Bank.allowCharacterId and (framework == 'qb' or framework == 'qbx'),
        },
        gallery = {
            maxImages = Config.Gallery.maxImages,
            allowUrlImport = Config.Gallery.allowUrlImport,
            allowedHosts = Config.Gallery.allowedHosts,
        },
        camera = {
            available = GetResourceState(Config.Gallery.screenshotResource) == 'started',
        },
        notes = Config.Notes,
        contacts = Config.Contacts,
        alarms = Config.Alarms,
        notifications = {
            bannerTime = Config.Notifications.bannerTime,
            showWhenClosed = Config.Notifications.showWhenClosed,
        },
        battery = {
            enabled = Config.Battery.enabled,
            lowWarning = Config.Battery.lowWarning,
        },
    }
end

---Called by the "ready" NUI callback (client/nui.lua).
function Nexora.OnNuiReady()
    State.nuiReady = true

    SendNUIMessage({ action = 'init', data = buildUiConfig() })

    if State.bootstrap then
        SendNUIMessage({ action = 'bootstrap', data = State.bootstrap })
    end

    local pending = queue
    queue = {}

    for i = 1, #pending do
        SendNUIMessage(pending[i])
    end
end

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

---Notification outside of the phone UI.
---@param message string
---@param kind? 'info'|'success'|'error'
function Nexora.Notify(message, kind)
    kind = kind or 'info'

    if Config.NotifyProvider == 'framework' and Bridge and Bridge.Notify then
        local ok = pcall(Bridge.Notify, message, kind)
        if ok then return end
    end

    lib.notify({
        title = Config.Brand.name,
        description = message,
        type = kind == 'info' and 'inform' or kind,
    })
end

---Calls a server callback. Never throws: failures come back as
---{ ok = false, error = 'internal' } just like server side errors.
---@param name string callback name without the "nexora-phone:" prefix
---@return table result
function Nexora.Callback(name, ...)
    local ok, result = pcall(lib.callback.await, 'nexora-phone:' .. name, false, ...)

    if not ok then
        Util.Debug(('callback "%s" failed: %s'):format(name, tostring(result)))
        return { ok = false, error = 'internal' }
    end

    if type(result) ~= 'table' then
        return { ok = false, error = 'internal' }
    end

    return result
end

local function isDead()
    local ped = cache.ped

    if IsEntityDead(ped) or IsPedFatallyInjured(ped) then return true end

    local state = LocalPlayer.state
    if state.isDead == true or state.dead == true then return true end

    return Bridge ~= nil and Bridge.IsDead() == true
end

local function isCuffed()
    if IsPedCuffed(cache.ped) then return true end

    local state = LocalPlayer.state
    if state.isHandcuffed == true or state.isCuffed == true or state.handcuffed == true then return true end

    return Bridge ~= nil and Bridge.IsCuffed() == true
end

---True when the phone has to stay away / be put away right now.
---@return boolean blocked
function Nexora.IsBlocked()
    if Config.DisableWhileDead and isDead() then return true end
    if Config.DisableWhileCuffed and isCuffed() then return true end
    return false
end

-------------------------------------------------------------------------------
-- Bootstrap
-------------------------------------------------------------------------------

local bootstrapping = false

---Fetches the character's phone data from the server and hands it to the UI.
---@return boolean success
function Nexora.Bootstrap()
    if bootstrapping then return false end
    bootstrapping = true

    local result = Nexora.Callback('bootstrap')

    bootstrapping = false

    if not result.ok then
        Util.Debug(('bootstrap not possible yet: %s'):format(tostring(result.error)))
        return false
    end

    State.ready = true
    State.number = result.number
    State.apps = result.apps or {}
    State.battery = tonumber(result.battery) or 100.0
    State.bootstrap = result

    if State.nuiReady then
        SendNUIMessage({ action = 'bootstrap', data = result })
    end

    Util.Debug(('phone ready, number %s'):format(tostring(result.number)))

    return true
end

---Forgets everything about the current character (logout / switch).
local function reset()
    if State.open then Nexora.Close() end

    Nexora.Camera.Stop(true)
    Nexora.Calls.Reset()
    Nexora.Phone.Cleanup()

    State.ready = false
    State.number = nil
    State.apps = {}
    State.bootstrap = nil
    State.alarmsActive = false

    Nexora.SendNUI('reset')
end

-------------------------------------------------------------------------------
-- Open / close
-------------------------------------------------------------------------------

local OPEN_ERRORS = {
    no_phone = 'no_phone',
    battery = 'phone_dead',
    rate_limited = 'rate_limited',
    not_ready = 'not_ready',
}

---Opens the phone. Returns false when it can not be opened right now.
---@param app? string id of an app to open straight away
---@return boolean opened
function Nexora.Open(app)
    if State.open or State.opening or State.camera then return false end
    if IsPauseMenuActive() then return false end

    if not State.ready and not Nexora.Bootstrap() then
        Nexora.Notify(locale('not_ready'), 'error')
        return false
    end

    if Nexora.IsBlocked() then
        Nexora.Notify(locale('cannot_open'), 'error')
        return false
    end

    if not Config.AllowWhileDriving and cache.vehicle and cache.seat == -1 then
        Nexora.Notify(locale('cannot_open'), 'error')
        return false
    end

    if Config.Battery.enabled and Config.Battery.shutdownAtZero and State.battery <= 0 then
        Nexora.Notify(locale('phone_dead'), 'error')
        return false
    end

    -- The server has the final word (phone item, battery).
    State.opening = true
    local result = Nexora.Callback('open')
    State.opening = false

    if not result.ok then
        Nexora.Notify(locale(OPEN_ERRORS[result.error] or 'cannot_open'), 'error')
        return false
    end

    if type(result.apps) == 'table' then
        State.apps = result.apps
    end

    State.open = true
    State.typing = false

    LocalPlayer.state:set('nexoraPhoneOpen', true, true)

    SetNuiFocus(true, true)
    SetNuiFocusKeepInput(Config.KeepInput == true)

    Nexora.SendNUI('open', {
        apps = State.apps,
        app = type(app) == 'string' and app or nil,
        status = Nexora.Phone.GetStatus(),
        time = Nexora.Phone.GetTime(),
    })

    Nexora.Phone.OnOpen()

    TriggerEvent('nexora-phone:client:opened')

    return true
end

---Closes the phone UI. A running call continues in the background.
function Nexora.Close()
    if not State.open then return end

    -- Leaving through the viewfinder: tear the scripted camera down first.
    Nexora.Camera.Stop(true)

    State.open = false
    State.typing = false

    LocalPlayer.state:set('nexoraPhoneOpen', false, true)

    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)

    Nexora.SendNUI('close')
    Nexora.Phone.OnClose()

    TriggerEvent('nexora-phone:client:closed')
end

function Nexora.Toggle()
    if State.open then
        -- Do not close on the open key while the player types a message.
        if State.typing then return end
        Nexora.Close()
    else
        Nexora.Open()
    end
end

-------------------------------------------------------------------------------
-- Keybind & command
-------------------------------------------------------------------------------

if Config.OpenKey then
    lib.addKeybind({
        name = 'nexora_phone_toggle',
        description = locale('keybind_description'),
        defaultKey = Config.OpenKey,
        onPressed = function()
            Nexora.Toggle()
        end,
    })
end

if Config.Command then
    RegisterCommand(Config.Command, function()
        Nexora.Toggle()
    end, false)
end

-------------------------------------------------------------------------------
-- Server events
-------------------------------------------------------------------------------

-- A character finished loading on the server.
RegisterNetEvent('nexora-phone:client:loaded', function()
    if State.ready then return end
    Nexora.Bootstrap()
end)

-- The character logged out / was switched.
RegisterNetEvent('nexora-phone:client:unloaded', function()
    reset()
end)

RegisterNetEvent('nexora-phone:client:apps', function(apps)
    if type(apps) ~= 'table' then return end

    State.apps = apps
    Nexora.SendNUI('apps', apps)
end)

RegisterNetEvent('nexora-phone:client:message', function(message)
    Nexora.SendNUI('message', message)
end)

RegisterNetEvent('nexora-phone:client:messagesRead', function(number)
    Nexora.SendNUI('messagesRead', { number = number })
end)

RegisterNetEvent('nexora-phone:client:notification', function(notification)
    Nexora.SendNUI('notification', notification)
end)

RegisterNetEvent('nexora-phone:client:bankTransaction', function(transaction)
    Nexora.SendNUI('bankTransaction', transaction)
end)

-------------------------------------------------------------------------------
-- Start / stop
-------------------------------------------------------------------------------

CreateThread(function()
    -- Covers a resource restart while a character is already loaded. On a
    -- normal join the server sends nexora-phone:client:loaded instead.
    Wait(500)

    if not State.ready then
        Nexora.Bootstrap()
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= Nexora.Resource then return end

    if State.open then
        SetNuiFocus(false, false)
        SetNuiFocusKeepInput(false)
    end

    LocalPlayer.state:set('nexoraPhoneOpen', false, true)

    Nexora.Camera.Stop(true)
    Nexora.Calls.Reset()
    Nexora.Phone.Cleanup()
end)

-------------------------------------------------------------------------------
-- Exports
-------------------------------------------------------------------------------

---exports['nexora-phone']:OpenPhone(app?) -> boolean
exports('OpenPhone', function(app)
    return Nexora.Open(app)
end)

---exports['nexora-phone']:ClosePhone()
exports('ClosePhone', function()
    Nexora.Close()
end)

---exports['nexora-phone']:TogglePhone()
exports('TogglePhone', function()
    Nexora.Toggle()
end)

---exports['nexora-phone']:IsOpen() -> boolean
exports('IsOpen', function()
    return State.open
end)

---exports['nexora-phone']:GetPhoneNumber() -> string?
---The number of the local player's current character.
exports('GetPhoneNumber', function()
    return State.number
end)

---exports['nexora-phone']:SendMessage(number, message) -> boolean ok, string? error
---Sends an SMS from the local player's phone. Goes through exactly the same
---server side validation as a message typed in the app.
exports('SendMessage', function(number, message)
    if not State.ready then return false, 'not_ready' end

    local result = Nexora.Callback('messages:send', number, message, 'text')

    if not result.ok then return false, result.error end

    Nexora.SendNUI('message', result.message)

    return true
end)

---exports['nexora-phone']:SendNotification(title, message, app?)
---Shows a notification on the local player's own phone (not stored).
---To notify another phone use the server export of the same name.
exports('SendNotification', function(title, message, app)
    if type(title) ~= 'string' or title == '' then return false end

    Nexora.SendNUI('notification', {
        app = type(app) == 'string' and app or 'system',
        title = title,
        body = type(message) == 'string' and message or '',
        ts = nil,
    })

    return true
end)

---exports['nexora-phone']:IsInCall() -> boolean
exports('IsInCall', function()
    return Nexora.Calls.IsActive()
end)

---exports['nexora-phone']:StartCall(number) -> boolean
---Opens the phone (when possible) and dials a number.
exports('StartCall', function(number)
    if not State.open and not Nexora.Open('phone') then return false end

    Nexora.SendNUI('dial', { number = tostring(number) })

    return true
end)
