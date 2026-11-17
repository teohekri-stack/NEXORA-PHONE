--[[---------------------------------------------------------------------------
    Nexora Phone - camera
    A scripted camera in front of the player with a rear and a selfie mode.
    While the viewfinder is active the UI releases the mouse cursor and the
    camera is driven by game controls:

        Mouse              look around          Arrow up / down   switch camera
        Scroll wheel       zoom                 Left click/Enter  take photo
        Backspace / ESC / right click           leave the camera

    Photos are taken with screenshot-basic and uploaded by the client to the
    target the server hands out (see README > Camera). The returned link is
    validated and stored by the server.
-----------------------------------------------------------------------------]]

local Util = Nexora.Util
local State = Nexora.State

Nexora.Camera = {}
local Camera = Nexora.Camera

local cam = nil         ---@type integer?
local selfie = false
local fov = Config.Camera.fov
local yaw, pitch = 0.0, 0.0
local busy = false      -- a photo is being taken / uploaded

local HEAD_HEIGHT = 0.62
local REAR_DISTANCE = 0.55
local SELFIE_DISTANCE = 0.9

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

local function canSave()
    return GetResourceState(Config.Gallery.screenshotResource) == 'started'
end

local function sendState()
    Nexora.SendNUI('camera:state', {
        active = State.camera,
        selfie = selfie,
        canSave = canSave(),
        zoom = Util.Round(Config.Camera.fov / fov, 1),
    })
end

---Pulls the image link out of the response of the upload host. Supports the
---common shapes: { url }, { data = { url | link } }, { attachments = { { url } } },
---{ link }, { files = { { url } } }.
---@param body any
---@return string?
local function extractUrl(body)
    if type(body) ~= 'string' or body == '' then return nil end

    local ok, data = pcall(json.decode, body)
    if not ok or type(data) ~= 'table' then return nil end

    if type(data.url) == 'string' then return data.url end
    if type(data.link) == 'string' then return data.link end

    if type(data.data) == 'table' then
        if type(data.data.url) == 'string' then return data.data.url end
        if type(data.data.link) == 'string' then return data.data.link end
    end

    local list = type(data.attachments) == 'table' and data.attachments
        or type(data.files) == 'table' and data.files
        or nil

    if list and type(list[1]) == 'table' and type(list[1].url) == 'string' then
        return list[1].url
    end

    return nil
end

---Positions the scripted camera for the current mode and view angles.
local function updateCamera()
    if not cam then return end

    local ped = cache.ped
    local origin = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped) + yaw
    local radians = math.rad(heading)
    local distance = selfie and SELFIE_DISTANCE or REAR_DISTANCE

    local head = vector3(origin.x, origin.y, origin.z + HEAD_HEIGHT)
    local target = vector3(
        origin.x - math.sin(radians) * distance,
        origin.y + math.cos(radians) * distance,
        origin.z + HEAD_HEIGHT
    )

    -- Keep the camera from being pushed through a wall the player faces.
    local ray = StartShapeTestRay(head.x, head.y, head.z, target.x, target.y, target.z, 17, ped, 7)
    local _, hit, hitCoords = GetShapeTestResult(ray)

    if hit == 1 or hit == true then
        local back = (head - hitCoords)
        local length = #back
        if length > 0.001 then
            target = hitCoords + (back / length) * 0.12
        end
    end

    SetCamCoord(cam, target.x, target.y, target.z)
    SetCamRot(cam, pitch, 0.0, (selfie and heading + 180.0 or heading) % 360.0, 2)
    SetCamFov(cam, fov)
end

-------------------------------------------------------------------------------
-- Taking a photo
-------------------------------------------------------------------------------

local function finishPhoto(result)
    busy = false
    Nexora.SendNUI('camera:result', result)
end

local function takePhoto()
    if busy then return end
    busy = true

    if not canSave() then
        finishPhoto({ ok = false, error = 'screenshot_missing' })
        return
    end

    -- The server decides where photos go and whether there is room for one.
    local target = Nexora.Callback('camera:prepare')

    if not target.ok then
        finishPhoto({ ok = false, error = target.error })
        return
    end

    if not State.camera then
        busy = false
        return
    end

    -- Hide the viewfinder overlay for the frames the picture is taken in.
    Nexora.SendNUI('camera:capture', { hide = true })
    Wait(150)

    local finished = false

    local requested = pcall(function()
        exports[Config.Gallery.screenshotResource]:requestScreenshotUpload(target.url, target.field, {
            encoding = target.encoding,
            quality = target.quality,
            headers = target.headers,
        }, function(response)
            if finished then return end
            finished = true

            CreateThread(function()
                local url = extractUrl(response)

                if not url then
                    finishPhoto({ ok = false, error = 'photo_failed' })
                    return
                end

                finishPhoto(Nexora.Callback('gallery:add', url, 'camera'))
            end)
        end)
    end)

    Wait(350)
    Nexora.SendNUI('camera:capture', { hide = false, flash = requested })

    if not requested then
        finished = true
        finishPhoto({ ok = false, error = 'photo_failed' })
        return
    end

    -- An upload that never answers must not block the camera for ever.
    SetTimeout(20000, function()
        if finished then return end
        finished = true
        finishPhoto({ ok = false, error = 'photo_failed' })
    end)
end

-------------------------------------------------------------------------------
-- Viewfinder loop (every frame, only while the camera is active)
-------------------------------------------------------------------------------

local function cameraLoop()
    local rules = Config.Camera
    local frame = 0

    cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', true)
    updateCamera()
    RenderScriptCams(true, false, 0, true, true)

    while State.camera do
        frame = frame + 1

        DisableAllControlActions(0)

        if rules.hideHud then
            HideHudAndRadarThisFrame()
        end

        -- Look around; movement gets slower the further the lens is zoomed in.
        local speed = rules.sensitivity * (fov / rules.fov)
        local yawLimit = selfie and 50.0 or 110.0
        local pitchLimit = selfie and 25.0 or 60.0

        yaw = Util.Clamp(yaw - GetDisabledControlNormal(0, 1) * speed, -yawLimit, yawLimit)
        pitch = Util.Clamp(pitch - GetDisabledControlNormal(0, 2) * speed, -pitchLimit, pitchLimit)

        -- Zoom (mouse wheel)
        if IsDisabledControlJustPressed(0, 241) or IsDisabledControlJustPressed(0, 15) then
            fov = math.max(rules.minFov, fov - 4.0)
            sendState()
        elseif IsDisabledControlJustPressed(0, 242) or IsDisabledControlJustPressed(0, 14) then
            fov = math.min(rules.maxFov, fov + 4.0)
            sendState()
        end

        -- Switch between rear camera and selfie (arrow up / down)
        if IsDisabledControlJustPressed(0, 172) or IsDisabledControlJustPressed(0, 173) then
            selfie = not selfie
            yaw, pitch = 0.0, 0.0
            sendState()
        end

        -- Shutter (left click / enter)
        if not busy and (IsDisabledControlJustPressed(0, 24) or IsDisabledControlJustPressed(0, 191)) then
            CreateThread(takePhoto)
        end

        -- Leave (backspace / ESC / right click)
        if IsDisabledControlJustPressed(0, 177) or IsDisabledControlJustPressed(0, 200)
            or IsDisabledControlJustPressed(0, 25)
        then
            Camera.Stop()
            break
        end

        -- Dying or getting cuffed puts the phone away.
        if frame % 30 == 0 and Nexora.IsBlocked() then
            Nexora.Close()
            break
        end

        updateCamera()

        Wait(0)
    end
end

-------------------------------------------------------------------------------
-- Public
-------------------------------------------------------------------------------

---Switches the phone into viewfinder mode.
---@return table result
function Camera.Start()
    if State.camera then return { ok = true } end
    if not State.open then return { ok = false, error = 'invalid' } end
    if Nexora.IsBlocked() then return { ok = false, error = 'not_allowed' } end

    State.camera = true
    State.typing = false

    selfie = false
    fov = Config.Camera.fov
    yaw, pitch = 0.0, 0.0

    -- Hand the mouse back to the game: it now aims the camera.
    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)

    sendState()

    -- Hook for HUD resources that want to hide while a photo is framed.
    TriggerEvent('nexora-phone:client:camera', true)

    CreateThread(cameraLoop)

    return { ok = true }
end

---Leaves viewfinder mode.
---@param silent? boolean do not give the cursor back (the phone is closing)
function Camera.Stop(silent)
    if not State.camera then return end

    State.camera = false

    if cam then
        RenderScriptCams(false, false, 0, true, true)
        DestroyCam(cam, false)
        cam = nil
    end

    TriggerEvent('nexora-phone:client:camera', false)

    sendState()

    if State.open and not silent then
        SetNuiFocus(true, true)
        SetNuiFocusKeepInput(Config.KeepInput == true)
    end
end
