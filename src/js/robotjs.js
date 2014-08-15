(function() {
    'use strict';

    var canvas = document.getElementById("canvas"), ctx = canvas.getContext("2d");
    var robots = [], bullets = [];

    // utility functions
    var Utils = {
        degree2radian: function(a) {
            return a * (Math.PI / 180);
        },
        distance: function(x1, y1, x2, y2) {
            return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
        },
        is_point_in_square: function(x1,y1, x2, y2, width, height) {
            return x1 >=x2 && x1 <= (x2 + width) && y1 >= y2 && y1 <= (y2 + height);
        },
    };

    var ARENA_WIDTH = 800;
    var ARENA_HEIGHT = 400;
    var ROBOT_SPEED = 1;
    var BULLET_SPEED = 3;

    function shoot(evt, battleManager, robot) {
        if (!robot.bullet) {
            robot.bullet = {
                x: robot.x,
                y: robot.y,
                direction: robot.direction + robot.turret_direction
            };
        }

        battleManager._send(robot.id, {
            signal: 'UPDATE',
            x: robot.x,
            y: robot.y
        });
    }

    function move(evt, battleManager, robot) {
        evt.progress += 1;

        var new_x = robot.x + (evt.distance > 0 ? 1 : -1) * Math.cos(Utils.degree2radian(robot.direction));
        var new_y = robot.y + (evt.distance > 0 ? 1 : -1) * Math.sin(Utils.degree2radian(robot.direction));

        var wallCollide = !Utils.is_point_in_square(new_x, new_y, 2, 2, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);

        if (wallCollide) {
            console.log('wall', robot.direction, robot.x, new_x, wallCollide);

            robot.health -= 1;

            battleManager._send(robot.id, {
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'WALL_COLLIDE'
            });

            return;
        }

        for (var i = 0, len = battleManager._robots.length; i < len; i++) {
            var enemy = battleManager._robots[i];

            if (robot.id === enemy.id) {
                continue;
            }

            var hit = Utils.distance(new_x, new_y, enemy.x, enemy.y) < 25;

            if (!hit) {
                continue;
            }

            enemy.health -= 1;
            robot.health -= 1;

            battleManager._send(robot.id, {
                signal: 'CALLBACK',
                callback_id: evt.callback_id,
                status: 'ENEMY_COLLIDE'
            });

            return;
        }


        if (evt.progress > Math.abs(evt.distance)) {
            console.log('move-over', robot.id);

            battleManager._send(robot.id, {
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

    function rotate(evt, battleManager, robot) {
        if (evt.progress === Math.abs(parseInt(evt.angle, 10))) {
            battleManager._send(robot.id, {
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

    function rotateTurret(evt, battleManager, robot) {
        if (evt.progress === Math.abs(evt.angle)) {
            battleManager._send(robot.id, {
                signal: 'CALLBACK',
                callback_id: evt.callback_id
            });

            return;
        }

        robot.turret_direction += (evt.angle > 0 ? 1 : -1);
        evt.progress += 1;

        return true;
    }

    function processSignal(evt, battle_manager, robot) {
        var signal = evt.signal;

        if (signal === 'SHOOT') {
            shoot(evt, battle_manager, robot);
            return;
        }

        if (signal === 'MOVE') {
            return move(evt, battle_manager, robot);
        }

        if (signal === 'ROTATE') {
            return rotate(evt, battle_manager, robot);
        }

        if (signal === 'ROTATE_TURRET') {
            return rotateTurret(evt, battle_manager, robot);
        }
    }

    function processBullet(battleManager, robot, robots) {
        var bullet = robot.bullet;

        bullet.x += BULLET_SPEED * Math.cos(Utils.degree2radian(bullet.direction));
        bullet.y += BULLET_SPEED * Math.sin(Utils.degree2radian(bullet.direction));

        var wallCollide = !Utils.is_point_in_square(bullet.x, bullet.y, 2, 2, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);

        if (wallCollide) {
            robot.bullet = null;
            return;
        }

        for (var j = 0, jlen = robots.length; j < jlen; j++) {
            var enemy = robots[j];

            if (robot.id === enemy.id) {
                continue;
            }

            var hit = Utils.distance(bullet.x, bullet.y, enemy.x, enemy.y) < 20;

            if (!hit) {
                continue;
            }

            console.log('Robot', robot.id, 'hit', enemy.id + '!');

            enemy.health -= 3;

            battleManager._explosions.push({
                x: enemy.x,
                y: enemy.y,
                progress: 1
            });

            robot.bullet = null;

            break;
        }
    }

    function buildContestantPath(contestantName){
        return '../src/contestants/' + contestantName + '/';
    }

    function createBaseRobot(battle_manager, id, src){
        var robot;
        var worker = new Worker(src);

        robot = {
            "id": id,
            "x": parseInt((ARENA_WIDTH-150)*Math.random(), 10),
            "y": parseInt((ARENA_HEIGHT-150)*Math.random(), 10),
            "health": 50,
            "direction": 40,
            "turret_direction": 0,
            "radar_direction": 0,
            "bullet": null,
            "events": []
        };

        robot.worker = worker;
        worker.onmessage = (function(id) {
            return function(e) {
                battle_manager._receive(id, e.data);
            };
        })(id);

        return robot;
    }

    function addRobotToBattleManager(battle_manager, robot){
        battle_manager._robots[robot.id] = robot;
        battle_manager._send(robot.id, {
            "signal": "INFO",
            "arena_height": ARENA_HEIGHT,
            "arena_width": ARENA_WIDTH
        });
    }

    function createRobots(battle_manager){
        Robojs.contestants.forEach(function(contestantName){
            var contestantPath = buildContestantPath(contestantName);
            var contestant = createBaseRobot(battle_manager, contestantName, contestantPath + 'brain.js');

            contestant.bodySrc = contestantPath + 'body.png';
            contestant.radarSrc = contestantPath + 'radar.png';
            contestant.turretSrc = contestantPath + 'turret.png';

            addRobotToBattleManager(battle_manager, contestant);
        });

        Robojs.bots.forEach(function(botName, i){
            var bot = createBaseRobot(battle_manager, botName + i, 'js/' + botName + '.js');

            addRobotToBattleManager(battle_manager, bot);
        });
    }

    var BattleManager = {
        _robots: {},
        _explosions: [],
        _ctx: null,

        init: function(ctx) {
            var battle_manager = this;
            battle_manager._ctx = ctx;

            createRobots(battle_manager);
        },

        _receive: function(robot_id, msg) {
            var msg_obj = JSON.parse(msg);
            var battle_manager = this;
            var robot = battle_manager._robots[robot_id];

            console.log(robot_id, msg);

            switch(msg_obj["signal"]) {
                default:
                    msg_obj["progress"] = 0;
                    robot.events.unshift(msg_obj);
                    break;
            }
        },
        _send: function(robot_id, msg_obj) {
            var battle_manager = this;
            var msg = JSON.stringify(msg_obj);
            battle_manager._robots[robot_id]["worker"].postMessage(msg);
        },
        _send_all: function(msg_obj) {
            var battle_manager = this;
            for(var r in battle_manager._robots) {
                battle_manager._send(r, msg_obj);
            }
        },

        run: function() {
            var battle_manager = this;

            setInterval(function() {
                battle_manager._run();
            }, 5);
            battle_manager._send_all({
                "signal": "RUN"
            });
        },
        _run: function() {
            var battle_manager = this;

            battle_manager._update();
            battle_manager._draw();
        },

        _update: function () {
            var robotIds = Object.keys(this._robots || {});
            var robots = [];

            Object.keys(this._robots || {}).forEach(function(id){
                var robot = BattleManager._robots[id];

                if (robot.health > 0) {
                    return robots.push(robot);
                }

                BattleManager._explosions.push({
                    x: robot.x,
                    y: robot.y,
                    progress: 1
                });

                delete BattleManager._robots[id];
            });

            robots.forEach(function (robot) {
                var nextEvents = [];

                if (robot.bullet) {
                    processBullet(BattleManager, robot, robots);
                }

                for(var e = 0; e < robot.events.length; e++) {
                    var evt = robot.events.pop();
                    var postponed = processSignal(evt, BattleManager, robot);

                    if (postponed) {
                        robot.events.unshift(evt);
                    }

                    BattleManager._send(robot.id, {
                        signal: 'update',
                        x: robot.x,
                        y: robot.y
                    });
                }
            });
        },

        _draw: function () {
            var battle_manager = this;

            battle_manager._ctx.clearRect(0, 0, 800, 400);


            function draw_robot(ctx, robot) {
                var body = new Image(), turret = new Image(), radar = new Image();
                body.src = robot.bodySrc || "img/robots/body.png";
                turret.src = robot.turretSrc || "img/robots/turret.png";
                radar.src = robot.radarSrc || "img/robots/radar.png";

                ctx.drawImage(body, -18, -18, 36, 36);
                ctx.rotate(Utils.degree2radian(robot["turret_direction"]));
                ctx.drawImage(turret, -25, -10, 54, 20);
                robot["radar_direction"]++;
                ctx.rotate(Utils.degree2radian(robot["radar_direction"]));
                ctx.drawImage(radar, -8, -11, 16, 22);
            }

            // draw robots
            for(var r in battle_manager._robots) {
                var robot = battle_manager._robots[r];

                // draw robot
                battle_manager._ctx.save();
                battle_manager._ctx.translate(robot["x"],robot["y"]);
                battle_manager._ctx.rotate(Utils.degree2radian(robot["direction"]));
                draw_robot(battle_manager._ctx, robot);
                battle_manager._ctx.restore();

                // draw bullet
                if(robot["bullet"]) {
                    battle_manager._ctx.save();
                    battle_manager._ctx.translate(robot["bullet"]["x"],robot["bullet"]["y"]);
                    battle_manager._ctx.rotate(Utils.degree2radian(robot["bullet"]["direction"]));
                    ctx.fillRect(-3,-3,6,6);
                    battle_manager._ctx.restore();
                }

                battle_manager._ctx.strokeText(robot["id"] + " (" + robot["health"] + ")", robot["x"]-20,robot["y"]+35);

                battle_manager._ctx.fillStyle = "green";
                battle_manager._ctx.fillRect(robot["x"]-20,robot["y"]+35, robot["health"], 5);
                battle_manager._ctx.fillStyle = "red";
                battle_manager._ctx.fillRect(robot["x"]-20+robot["health"],robot["y"]+35, 25-robot["health"], 5);
                battle_manager._ctx.fillStyle = "black";

            }
            for(var e=0; e<battle_manager._explosions.length; e++) {
                var explosion = battle_manager._explosions.pop();

                if(explosion["progress"]<=17) {
                    var explosion_img = new Image();
                    explosion_img.src = "img/explosion/explosion1-" + parseInt(explosion["progress"], 10)+'.png';
                    battle_manager._ctx.drawImage(explosion_img, explosion["x"]-64, explosion["y"]-64, 128, 128);
                    explosion["progress"]+= 0.1;
                    battle_manager._explosions.unshift(explosion);
                }
            }
        },
    };

    BattleManager.init(ctx);
    BattleManager.run();

})();
