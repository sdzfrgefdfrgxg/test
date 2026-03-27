local Players = game:GetService("Players")
local player = Players.LocalPlayer
local mouse = player:GetMouse()
local vel_x       = 0
local vel_y       = 0
local wander_angle = math.random() * math.pi * 2
local last_target  = nil
local bez_t        = 0
local bez_cx       = 0
local bez_cy       = 0
local bez_end_x    = 0
local bez_end_y    = 0

-- Delta-time tracking
local last_tick = os.clock()
local TARGET_DT = 1 / 240  -- what we treat as "one normal frame"

local function dist(a, b)
    return math.sqrt((b.x - a.x)^2 + (b.y - a.y)^2 + (b.z - a.z)^2)
end

local function get_cursor()
    local client_folder = game.Workspace.Client
    if not client_folder then return end
    local game_folder = client_folder.Game
    if not game_folder then return end
    for _, cursor in ipairs(game_folder:GetChildren()) do
        if cursor.Name == "Cursor" and #cursor:GetChildren() > 0 then
            return cursor
        end
    end
    return nil
end

local function get_next_square()
    local client_folder = game.Workspace.Client
    if not client_folder then return end
    local game_folder = client_folder.Game
    if not game_folder then return end
    local cursor = get_cursor()
    if not cursor then return end
    local nearest_square = nil
    local nearest_square_distance = math.huge
    for _, square in ipairs(game_folder:GetChildren()) do
        if square:IsA("Part") and square.Name == "" then
            local d = dist(cursor.Position, square.Position)
            if d < nearest_square_distance then
                nearest_square = square
                nearest_square_distance = d
            end
        end
    end
    return nearest_square, nearest_square_distance
end

local function bezier(ax, ay, bx, by, cx, cy, t)
    local mt = 1 - t
    return mt*mt*ax + 2*mt*t*bx + t*t*cx,
           mt*mt*ay + 2*mt*t*by + t*t*cy
end

local function move_mouse(square, dt_scale)
    if not square then return end

    local cursor = get_cursor()
    if not cursor then return end

    local square_screen, on_screen = WorldToScreen(square.Position)
    if not on_screen then return end

    local cursor_screen, cursor_on_screen = WorldToScreen(cursor.Position)
    if not cursor_on_screen then return end

    -- random frame skip (dt-independent: use probability per second scaled by dt)
    if math.random() < _G.settings.skip_chance * dt_scale then return end

    local tx = square_screen.X
    local ty = square_screen.Y
    local cx_pos = cursor_screen.X
    local cy_pos = cursor_screen.Y

    local delta_x = tx - cx_pos
    local delta_y = ty - cy_pos
    local pixel_dist = math.sqrt(delta_x*delta_x + delta_y*delta_y)

    if last_target ~= square then
        last_target = square
        bez_t = 0
        bez_end_x = tx
        bez_end_y = ty

        local perp_x = -delta_y
        local perp_y =  delta_x
        local perp_len = math.sqrt(perp_x*perp_x + perp_y*perp_y)
        if perp_len > 0.001 then
            perp_x = perp_x / perp_len
            perp_y = perp_y / perp_len
        end

        local sign = (math.random() > 0.5) and 1 or -1
        local arc_dist = pixel_dist * _G.settings.curve_strength * sign
        bez_cx = (cx_pos + tx) * 0.5 + perp_x * arc_dist
        bez_cy = (cy_pos + ty) * 0.5 + perp_y * arc_dist
    end

    local t_val = math.clamp(pixel_dist / _G.settings.near_threshold, 0, 1)
    local smoothing = _G.settings.smoothing_near
        + (_G.settings.smoothing_far - _G.settings.smoothing_near) * t_val

    -- Scale smoothing step by dt so speed is consistent regardless of frame rate
    local smoothing_scaled = smoothing * dt_scale

    local next_t = math.clamp(bez_t + smoothing_scaled, 0, 1)
    local bx_next, by_next = bezier(cx_pos, cy_pos, bez_cx, bez_cy, bez_end_x, bez_end_y, next_t)
    bez_t = next_t

    local ideal_dx = bx_next - cx_pos
    local ideal_dy = by_next - cy_pos

    -- Momentum factor scaled by dt so it doesn't over-carry during lag spikes
    local m = _G.settings.momentum ^ dt_scale  -- exponential decay is dt-correct
    local raw_dx = ideal_dx * (1 - m) + vel_x * m
    local raw_dy = ideal_dy * (1 - m) + vel_y * m

    local jitter_scale = 1 - math.clamp(pixel_dist / _G.settings.near_threshold, 0, 1)
    local jitter_r = jitter_scale * _G.settings.jitter_max * _G.settings.axis_noise * dt_scale
    raw_dx = raw_dx + (math.random() * 2 - 1) * jitter_r
    raw_dy = raw_dy + (math.random() * 2 - 1) * jitter_r

    vel_x = raw_dx
    vel_y = raw_dy

    mousemoverel(raw_dx, raw_dy)
end

task.spawn(function()
    while true and isrbxactive() do
        -- Measure real elapsed time since last tick
        local now = os.clock()
        local real_dt = now - last_tick
        last_tick = now

        -- Clamp dt: if a massive stutter happened (>100ms), don't let it
        -- send a huge movement burst. Cap at ~3 normal frames worth.
        real_dt = math.clamp(real_dt, 0, TARGET_DT * 3)

        -- dt_scale: 1.0 = exactly on time, >1 = late (do more), <1 = early (do less)
        local dt_scale = real_dt / TARGET_DT

        local next_square, next_square_distance = get_next_square()

        if next_square and next_square_distance < _G.settings.distance_before_move then
            move_mouse(next_square, dt_scale)
        else
            last_target = nil

            if math.abs(vel_x) > 0.08 or math.abs(vel_y) > 0.08 then
                -- dt-correct glide decay: exponential form so it's frame-rate independent
                local decay = _G.settings.glide_decay ^ dt_scale
                vel_x = vel_x * decay
                vel_y = vel_y * decay

                local speed = math.sqrt(vel_x*vel_x + vel_y*vel_y)
                local tremor = speed * _G.settings.glide_tremor * dt_scale
                local tx = vel_x + (math.random() * 2 - 1) * tremor
                local ty = vel_y + (math.random() * 2 - 1) * tremor
                mousemoverel(tx, ty)
            else
                vel_x = 0
                vel_y = 0
                -- Wander speed scaled by dt so it drifts at a consistent pace
                wander_angle = wander_angle + _G.settings.wander_speed * dt_scale * (math.random() * 2 - 1)
                local r = _G.settings.wander_radius * math.random() * dt_scale
                mousemoverel(math.cos(wander_angle) * r, math.sin(wander_angle) * r)
            end
        end

        task.wait(1/240)
    end
end)
