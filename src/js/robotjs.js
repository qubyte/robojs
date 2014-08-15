(function(Robojs) {
    'use strict';

    var canvas = document.getElementById('canvas');
    var ctx = canvas.getContext('2d');

    var explosionFrames = (function () {
        var frames = [];

        for (var i = 1; i <= 17; i++) {
            var explosionFrame = new Image();

            explosionFrame.src = 'img/explosion/explosion1-' + i + '.png';

            frames.push(explosionFrame);
        }

        return frames;
    })();

    // utility functions
    function degree2radian(deg) {
        return deg * Math.PI / 180;
    }

    function distance(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    }

    function is_point_in_square(x1, y1, x2, y2, width, height) {
        return x1 >=x2 && x1 <= (x2 + width) && y1 >= y2 && y1 <= (y2 + height);
    }

    var ARENA_WIDTH = 800;
    var ARENA_HEIGHT = 400;
    var BULLET_SPEED = 3;

    function Robot(options) {
        var robot = this;

        this.id = options.id;
        this.worker = new Worker(options.src);
        this.x = parseInt((ARENA_WIDTH - 150) * Math.random(), 10);
        this.y = parseInt((ARENA_HEIGHT - 150) * Math.random(), 10);
        this.health = 50;
        this.direction = 40;
        this.turretDirection = 0;
        this.radarDirection = 0;
        this.events = [];

        this.body = new Image();
        this.body.src = options.bodySrc || 'img/robots/body.png';

        this.radar = new Image();
        this.radar.src = options.radarSrc || 'img/robots/turret.png';

        this.turret = new Image();
        this.turret.src = options.turretSrc || 'img/robots/radar.png';

        this.worker.onmessage = function(e) {
            robot.receive(e.data);
        };
    }

    Robot.prototype.send = function (message) {
        this.worker.postMessage(JSON.stringify(message));
    };

    Robot.prototype.receive = function (messageString) {
        var message = JSON.parse(messageString);

        console.log(this.id, messageString);

        message.progress = 0;

        this.events.unshift(message);
    };

    function shoot(evt, bullets, robot) {
        var now = Date.now();

        if (!robot.lastShot || now - robot.lastShot > 2500) {
            bullets.push({
                ownerId: robot.id,
                x: robot.x,
                y: robot.y,
                direction: robot.direction + robot.turretDirection
            });

            robot.lastShot = now;
        }

        robot.send({
            signal: 'UPDATE',
            x: robot.x,
            y: robot.y
        });
    }

    function move(evt, bullets, robot, robots) {
        evt.progress += 1;

        var new_x = robot.x + (evt.distance > 0 ? 1 : -1) * Math.cos(degree2radian(robot.direction));
        var new_y = robot.y + (evt.distance > 0 ? 1 : -1) * Math.sin(degree2radian(robot.direction));

        var inArena = is_point_in_square(new_x, new_y, 2, 2, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);

        if (!inArena) {
            console.log('wall', robot.direction, robot.x, new_x);

            robot.health -= 1;

            robot.send({
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'WALL_COLLIDE'
            });

            return;
        }

        for (var i = 0, len = robots.length; i < len; i++) {
            var enemy = robots[i];

            if (robot.id === enemy.id) {
                continue;
            }

            var hit = distance(new_x, new_y, enemy.x, enemy.y) < 25;

            if (!hit) {
                continue;
            }

            enemy.health -= 1;
            robot.health -= 1;

            robot.send({
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'ENEMY_COLLIDE'
            });

            return;
        }


        if (evt.progress > Math.abs(evt.distance)) {
            console.log('move-over', robot.id);

            robot.send({
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'DONE'
            });

            return;
        }

        robot.x = new_x;
        robot.y = new_y;

        return true;
    }

    function rotate(evt, bullets, robot) {
        if (evt.progress === Math.abs(parseInt(evt.angle, 10))) {
            robot.send({
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'DONE'
            });

            return;
        }

        robot.direction += (evt.angle > 0 ? 1 : -1);
        evt.progress += 1;

        return true;
    }

    function rotateTurret(evt, bullets, robot) {
        if (evt.progress === Math.abs(evt.angle)) {
            robot.send({
                signal: 'CALLBACK',
                callback_id: evt.callback_id
            });

            return;
        }

        robot.turretDirection += (evt.angle > 0 ? 1 : -1);
        evt.progress += 1;

        return true;
    }

    function processSignal(evt, bullets, robot, robots) {
        var signal = evt.signal;

        switch (signal) {
            case 'SHOOT':
                return shoot(evt, bullets, robot);

            case 'MOVE':
                return move(evt, bullets, robot, robots);

            case 'ROTATE':
                return rotate(evt, bullets, robot);

            case 'ROTATE_TURRET':
                return rotateTurret(evt, bullets, robot);
        }
    }

    function processBullet(explosions, bullet, robots) {
        bullet.x += BULLET_SPEED * Math.cos(degree2radian(bullet.direction));
        bullet.y += BULLET_SPEED * Math.sin(degree2radian(bullet.direction));

        var inArena = is_point_in_square(bullet.x, bullet.y, 2, 2, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);

        if (!inArena) {
            return true;
        }

        for (var i = 0, ilen = robots.length; i < ilen; i++) {
            var enemy = robots[i];

            if (bullet.ownerId === enemy.id) {
                continue;
            }

            var hit = distance(bullet.x, bullet.y, enemy.x, enemy.y) < 20;

            if (!hit) {
                continue;
            }

            console.log('Robot', bullet.ownerId, 'hit', enemy.id + '!');

            enemy.health -= 3;

            explosions.push({
                x: enemy.x,
                y: enemy.y,
                progress: 1
            });

            return true;
        }
    }

    function createRobots() {
        var robots = [];

        Robojs.contestants.forEach(function(id){
            var contestantPath = '../src/contestants/' + id + '/';

            robots.push(new Robot({
                id: id,
                src: contestantPath + 'brain.js',
                bodySrc: contestantPath + 'body.png',
                radarSrc: contestantPath + 'radar.png',
                turretSrc: contestantPath + 'turret.png'
            }));
        });

        Robojs.bots.forEach(function(botName, i){
            robots.push(new Robot({
                id: botName + i,
                src: 'js/' + botName + '.js'
            }));
        });

        return robots;
    }

    function update(robots, bullets, explosions) {
        var robot;

        // Looping backwards here to keep indices consistent when splicing dead robots out.
        for (var i = robots.length - 1; i >= 0; i--) {
            robot = robots[i];

            if (robot.health > 0) {
                continue;
            }

            explosions.push({
                x: robot.x,
                y: robot.y,
                progress: 1
            });

            robots.splice(i, 1);
        }

        for (var j = bullets.length - 1; j >= 0; j--) {
            var bullet = bullets[j];

            var spent = processBullet(explosions, bullet, robots);

            if (spent) {
                bullets.splice(j, 1);
            }
        }

        for (var k = 0, klen = robots.length; k < klen; k++) {
            robot = robots[k];

            var nextEvents = [];

            for(var e = 0; e < robot.events.length; e++) {
                var evt = robot.events[e];
                var postponed = processSignal(evt, bullets, robot, robots);

                if (postponed) {
                    nextEvents.push(evt);
                }

                robot.send({
                    signal: 'update',
                    x: robot.x,
                    y: robot.y
                });
            }

            robot.events = nextEvents;
        }
    }

    function draw(robots, bullets, explosions, ctx) {
        ctx.clearRect(0, 0, 800, 400);

        function drawRobot(ctx, robot) {
            ctx.drawImage(robot.body, -18, -18, 36, 36);
            ctx.rotate(degree2radian(robot.turretDirection));
            ctx.drawImage(robot.turret, -25, -10, 54, 20);
            robot.radarDirection += 1;
            ctx.rotate(degree2radian(robot.radarDirection));
            ctx.drawImage(robot.radar, -8, -11, 16, 22);
        }

        // draw robots
        for (var i = 0, ilen = robots.length; i < ilen; i++) {
            var robot = robots[i];

            // draw robot
            ctx.save();
            ctx.translate(robot.x,robot.y);
            ctx.rotate(degree2radian(robot.direction));
            drawRobot(ctx, robot);
            ctx.restore();

            ctx.strokeText(robot.id + ' (' + robot.health + ')', robot.x - 20, robot.y + 35);
            ctx.fillStyle = 'green';
            ctx.fillRect(robot.x - 20, robot.y + 35, robot.health, 5);
            ctx.fillStyle = 'red';
            ctx.fillRect(robot.x - 20 + robot.health, robot.y + 35, 25 - robot.health, 5);
            ctx.fillStyle = 'black';
        }

        for (var j = 0, jlen = bullets.length; j < jlen; j++) {
            var bullet = bullets[j];

            ctx.save();
            ctx.translate(bullet.x, bullet.y);
            ctx.rotate(degree2radian(bullet.direction));
            ctx.fillRect(-3, -3, 6, 6);
            ctx.restore();
        }

        for (var k = explosions.length - 1; k >= 0; k--) {
            var explosion = explosions[k];
            var progress = explosion.progress;

            if (progress > 17) {
                explosions.splice(k, 1);
                continue;
            }

            ctx.drawImage(explosionFrames[parseInt(progress, 10)], explosion.x - 64, explosion.y - 64, 128, 128);
            explosion.progress += 0.1;
        }
    }

    function BattleManager(context) {
        var bullets = [];
        var explosions = [];
        var robots = createRobots(this);

        this.run = function() {
            setInterval(function() {
                update(robots, bullets, explosions);
                draw(robots, bullets, explosions, context);
            }, 5);

            for (var i = 0, len = robots.length; i < len; i++) {
                robots[i].send({ 'signal': 'RUN' });
            }
        };
    }

    new BattleManager(ctx).run();
})(Robojs);
