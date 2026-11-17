--[[---------------------------------------------------------------------------
    Nexora Phone - the physical phone
    Prop + animations, the status bar (clock, battery, signal) and the input
    handling while the UI is open.

    Threads:
      * control loop  - every frame, ONLY while the phone is open
      * open loop     - once per second, ONLY while the phone is open
      * idle loop     - every 30 s (5 s when an alarm needs the game clock),
                        skipped entirely when neither battery nor game-clock
                        alarms need it
-----------------------------------------------------------------------------]]

local Util = Nexora.Util
local State = Nexora.State

Nexora.Phone = {}
local Phone = Nexora.Phone

local prop = nil            ---@type integer? phone object in the player's hand
local animMode = nil        ---@type 'idle'|'call'|nil animation that should be playing
local animSet = nil         ---@type table? Config.Animations set currently in use
local lastMinute = -1
local lastSignal = -1
local lastSynced = nil      ---@type number? battery level last sent to the server

-- Controls that stay disabled while the UI is open and the player keeps
-- control of the character (camera, combat, weapon wheel, pause menu, radio).
local DISABLED_CONTROLS = {
    1, 2, 3, 4, 5, 6,               -- look
    12, 13, 14, 15, 16, 17, 37,     -- weapon wheel / selection
    24, 25, 257,                    -- attack / aim
    44, 45, 47, 58,                 -- cover, reload, detonate, grenade
    66, 67, 68, 69, 70,             -- vehicle weapons
    81, 82, 85,                     -- vehicle radio
    91, 92, 99, 100, 106, 114,      -- passenger weapons / mouse control override
    140, 141, 142, 143, 263, 264,   -- melee
    199, 200, 322,                  -- pause menu / ESC
    245,                            -- chat
    261, 262,                       -- scroll weapon
}

-------------------------------------------------------------------------------
-- Status bar
-------------------------------------------------------------------------------

---In-game date and time, or nil when the phone shows the real time.
---@return table?
function Phone.GetTime()
    if Config.ClockSource ~= 'game' then return nil end

    return {
        h = GetClockHours(),
        m = GetClockMinutes(),
        dow = GetClockDayOfWeek(),      -- 0 = Sunday
        d = GetClockDayOfMonth(),
        mo = GetClockMonth(),           -- 0 = January
        y = GetClockYear(),
    }
end

---Reception in bars (0 - 4). Dead zones are also enforced by the server.
---@return integer
function Phone.GetSignal()
    local rules = Config.Signal
    if not rules.enabled then return 4 end

    local ped = cache.ped
    local coords = GetEntityCoords(ped)

    for i = 1, #rules.deadZones do
        local zone = rules.deadZones[i]
        if #(coords - zone.coords) <= zone.radius then return 0 end
    end

    local bars = 4

    if rules.fullDistance > 0 and rules.fadeDistance > 0 then
        local distance = math.sqrt(coords.x * coords.x + coords.y * coords.y)
        if distance > rules.fullDistance then
            bars = bars - math.ceil((distance - rules.fullDistance) / rules.fadeDistance)
        end
    end

    if rules.interiorPenalty > 0 and GetInteriorFromEntity(ped) ~= 0 then
        bars = bars - rules.interiorPenalty
    end

    return Util.Clamp(bars, 1, 4)
end

---@return { battery: integer, charging: boolean, signal: integer }
function Phone.GetStatus()
    lastSignal = Phone.GetSignal()

    return {
        battery = math.floor(State.battery + 0.5),
        charging = State.charging,
        signal = lastSignal,
    }
end

-------------------------------------------------------------------------------
-- Battery
-------------------------------------------------------------------------------

local function isCharging()
    if not Config.Battery.chargeInVehicle then return false end

    local vehicle = cache.vehicle
    return vehicle and GetIsVehicleEngineRunning(vehicle) or false
end

---Reports the battery level to the server (which stores it with the settings).
---@param force? boolean send even when it barely changed
local function syncBattery(force)
    if not Config.Battery.enabled or not State.ready then return end

    local level = State.battery

    if not force and lastSynced then
        local crossedZero = (level <= 0) ~= (lastSynced <= 0)
        if not crossedZero and math.abs(level - lastSynced) < 2.0 then return end
    end

    if lastSynced == level then return end

    lastSynced = level
    TriggerServerEvent('nexora-phone:server:battery', level)
end

---Drains / charges the battery for the time that passed.
---@param seconds number real seconds since the previous update
local function updateBattery(seconds)
    local rules = Config.Battery
    if not rules.enabled then return end

    local before = State.battery
    local wasCharging = State.charging
    local charging = isCharging()
    local rate

    if charging then
        rate = rules.chargePerMinute
    elseif State.open or Nexora.Calls.IsActive() then
        rate = -rules.drainPerMinute
    else
        rate = -rules.idleDrainPerMinute
    end

    State.charging = charging
    State.battery = Util.Clamp(before + rate * seconds / 60.0, 0.0, 100.0)

    local shown = math.floor(State.battery + 0.5)
    local previous = math.floor(before + 0.5)

    if shown ~= previous or charging ~= wasCharging then
        Nexora.SendNUI('status', Phone.GetStatus())
    end

    if not charging and previous > rules.lowWarning and shown <= rules.lowWarning and shown > 0 then
        Nexora.SendNUI('notification', {
            app = 'system',
            title = locale('low_battery'),
            body = locale('low_battery_body', shown),
        })
    end

    syncBattery(false)

    if rules.shutdownAtZero and State.battery <= 0 and State.open then
        Nexora.Close()
        Nexora.Notify(locale('phone_dead'), 'error')
    end
end

-------------------------------------------------------------------------------
-- Prop & animation
-------------------------------------------------------------------------------

local function removeProp()
    if not prop then return end

    if DoesEntityExist(prop) then
        DetachEntity(prop, true, false)
        DeleteEntity(prop)
    end

    prop = nil
end

local function attachProp()
    if not Config.Prop.enabled or prop then return end

    local model = joaat(Config.Prop.model)
    if not pcall(lib.requestModel, model, 2000) then return end

    local ped = cache.ped
    local coords = GetEntityCoords(ped)
    local offset, rotation = Config.Prop.offset, Config.Prop.rotation

    prop = CreateObject(model, coords.x, coords.y, coords.z + 0.2, true, true, false)

    AttachEntityToEntity(prop, ped, GetPedBoneIndex(ped, Config.Prop.bone),
        offset.x, offset.y, offset.z, rotation.x, rotation.y, rotation.z,
        true, true, false, true, 1, true)

    SetModelAsNoLongerNeeded(model)
end

local function currentAnimSet()
    return cache.vehicle and Config.Animations.vehicle or Config.Animations.foot
end

---Starts the animation for a mode, or puts the phone away for nil.
---@param mode 'idle'|'call'|nil
local function setAnimation(mode)
    local previousSet = animSet

    animMode = mode

    if not mode then
        animSet = nil

        if Config.Animations.enabled and previousSet and pcall(lib.requestAnimDict, previousSet.dict, 1500) then
            local ped = cache.ped
            TaskPlayAnim(ped, previousSet.dict, previousSet.close, 3.0, 3.0, -1, 48, 0.0, false, false, false)

            SetTimeout(450, function()
                -- Reopened in the meantime? Then leave the new animation alone.
                if animMode then return end
                StopAnimTask(cache.ped, previousSet.dict, previousSet.close, 2.0)
                removeProp()
            end)
        else
            removeProp()
        end

        return
    end

    attachProp()

    if not Config.Animations.enabled then return end

    local set = currentAnimSet()
    animSet = set

    if pcall(lib.requestAnimDict, set.dict, 1500) then
        -- 49 = loop + upper body only + secondary task (the player can walk)
        TaskPlayAnim(cache.ped, set.dict, mode == 'call' and set.call or set.idle,
            3.0, 3.0, -1, 49, 0.0, false, false, false)
    end
end

---Works out which animation should play (call > open > none) and applies it.
function Phone.RefreshAnimation()
    local mode = nil

    if Nexora.Calls.IsOnLine() then
        mode = 'call'
    elseif State.open then
        mode = 'idle'
    end

    if mode ~= animMode then
        setAnimation(mode)
    end
end

---Restarts the animation when something interrupted it (ragdoll, entering a
---vehicle, another script clearing tasks). Called about once per second.
function Phone.EnsureAnimation()
    if not animMode or not Config.Animations.enabled then return end

    local set = currentAnimSet()
    local name = animMode == 'call' and set.call or set.idle

    if set ~= animSet or not IsEntityPlayingAnim(cache.ped, set.dict, name, 3) then
        setAnimation(animMode)
    end
end

-------------------------------------------------------------------------------
-- Loops
-------------------------------------------------------------------------------

local function startControlLoop()
    CreateThread(function()
        local playerId = cache.playerId

        while State.open do
            -- While typing (or in the viewfinder) the game gets no input from us anyway.
            if not State.typing and not State.camera then
                for i = 1, #DISABLED_CONTROLS do
                    DisableControlAction(0, DISABLED_CONTROLS[i], true)
                end
                DisablePlayerFiring(playerId, true)
            end

            Wait(0)
        end
    end)
end

---Keeps the key / click that closed the phone from reaching the game
---(ESC would open the pause menu, a click would throw a punch).
local function swallowInput()
    CreateThread(function()
        local playerId = cache.playerId
        local stopAt = GetGameTimer() + 350

        while GetGameTimer() < stopAt and not State.open do
            DisableControlAction(0, 199, true)
            DisableControlAction(0, 200, true)
            DisableControlAction(0, 322, true)
            DisableControlAction(0, 24, true)
            DisableControlAction(0, 25, true)
            DisableControlAction(0, 140, true)
            DisablePlayerFiring(playerId, true)
            Wait(0)
        end
    end)
end

local function startOpenLoop()
    CreateThread(function()
        local last = GetGameTimer()
        local ticks = 0

        while State.open do
            Wait(1000)
            if not State.open then break end

            local now = GetGameTimer()
            local elapsed = (now - last) / 1000.0
            last = now
            ticks = ticks + 1

            -- Dying or getting cuffed puts the phone away.
            if Nexora.IsBlocked() then
                Nexora.Close()
                break
            end

            if Config.ClockSource == 'game' then
                local minute = GetClockMinutes()
                if minute ~= lastMinute then
                    lastMinute = minute
                    Nexora.SendNUI('time', Phone.GetTime())
                end
            end

            updateBattery(elapsed)

            if ticks % 5 == 0 and Phone.GetSignal() ~= lastSignal then
                Nexora.SendNUI('status', Phone.GetStatus())
            end

            Phone.EnsureAnimation()
        end
    end)
end

-- Background upkeep while the phone is in the pocket.
if Config.Battery.enabled or Config.ClockSource == 'game' then
    CreateThread(function()
        local last = GetGameTimer()

        while true do
            local needsClock = Config.ClockSource == 'game' and State.alarmsActive

            Wait(needsClock and 5000 or 30000)

            local now = GetGameTimer()
            local elapsed = (now - last) / 1000.0
            last = now

            if State.ready and not State.open then
                updateBattery(elapsed)

                if needsClock then
                    Nexora.SendNUI('time', Phone.GetTime())
                end
            end
        end
    end)
end

-------------------------------------------------------------------------------
-- Hooks used by client/main.lua
-------------------------------------------------------------------------------

function Phone.OnOpen()
    lastMinute = Config.ClockSource == 'game' and GetClockMinutes() or -1

    Phone.RefreshAnimation()
    startOpenLoop()

    if Config.KeepInput then
        startControlLoop()
    end
end

function Phone.OnClose()
    Phone.RefreshAnimation()
    syncBattery(true)
    swallowInput()
end

---Removes everything this file created (logout, resource stop).
function Phone.Cleanup()
    local set = animSet

    animMode = nil
    animSet = nil
    lastSynced = nil

    if set then
        local ped = cache.ped
        StopAnimTask(ped, set.dict, set.idle, 2.0)
        StopAnimTask(ped, set.dict, set.call, 2.0)
    end

    removeProp()
end
