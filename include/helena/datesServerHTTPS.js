"use strict";
const pg = require('pg');
const session = require('cookie-session')({secret: 'securedsession'});
const cookieParser = require('cookie-parser')();

let io;
let conString;//global connection string
let client;// global connection client

const actual_dates = {};//acceprted and acceptable
const concrete_user_dates = {};//[uid] all info
const establish_connection = {};//have to establish connection!
const current_partners = {};//established connection!

const videodates_windows = {};//list of videodates!
let user_tokens = {};//[man_id]=tokens avaliable
const roomDataObject = {};//users in room (with admins)

let admin_sockets_server;//socket for ADMIN.HELENA (crm)
let server;

//var fullRateType;//full rate list

const rateChatType = {};//price for service

const MONITOR_ROOM_TOKENS_INTERVAL = 60 * 1000;
const TIME_FOR_VIDEO_DATE = 60 * 1000;


const log = require("./collor-logger");


//TODO remove http server ! Leave only https one
module.exports = function (share_obj) {

    let app = share_obj.app;
    user_tokens = share_obj.user_tokens;
    admin_sockets_server = share_obj.admin_sockets;

    let parsedJSON = require(app.dir + '/config/configServer.json');
    let dateConf = parsedJSON.videoDateServ;

    let PORT = dateConf.server.portHTTPS;
    let PORTHTTP = dateConf.server.portHTTP;

    conString = 'pg://' + dateConf.dataBase.admin + ':' + dateConf.dataBase.pass + '@' + dateConf.dataBase.host + ':' + dateConf.dataBase.port + '/' + dateConf.dataBase.dbname;

    log.info("DB constring " + conString);


    client = new pg.Client(conString);

    client.connect((err) => {
        if (err) {
            log.error(err)
        }

        getChatRate();

        actual_dates._modyfing = new Promise(function (resolve, reject) {
            getAllDates(resolve, reject)
        });
    });

    server = require('https').createServer(app.secureOptions, app);
    const serverHttp = require('http').createServer(app);
    io = require('socket.io').listen(server);
    /*WTF??*/

    io.attach(serverHttp);
    io.set("transports", ["xhr-polling", "polling", 'websocket']);

    io.use(function (socket, next) {
        let req = socket.handshake;
        let res = {};
        cookieParser(req, res, function (err) {
            if (err) return next(err);
            session(req, res, next);
        });
    });


    server.listen(PORT, function () {
        log.info("http Server started at "+PORT)
    });
    serverHttp.listen(PORTHTTP, function() {
        log.info("https Server started at "+PORTHTTP)
    });



    //=========SOCKETS
    io.sockets.on('connection', function (socket) {

        let userSex;
        let userId;
        let referer;

        try {
            referer = socket.request.headers.referer;
            userId = socket.handshake.session.passport.user.user_id.toString();
            userSex = socket.handshake.session.passport.user.sex.toString();

            log.info("User connected");
            log.info("referer : " + referer);
            log.info("userId : " + userId);
            log.info("userSex : " + userSex);
        }
        catch (e) {
            if (userId === undefined) {
                userId = 'admin' + new Date().getMilliseconds();
                userSex = 3;//admin
            }
        }

        socket.join(userId);


        socket.on('id event', function (data) {
            if (data.type === 'browser') {
                log.info('id event browser with id '+userId);
                sendActualTimers(userId, userSex);
            }
            else if (data.type === 'videoWindow') {

                log.info('id event videoWindow with id '+userId);
                videodates_windows[userId] = videodates_windows[userId]!==undefined ? videodates_windows[userId] : 1;

                sendActualPartnerInfo(userId, userSex);

                //next function drops if vdate is not actual;
                sendRoomToOpen(userId, userSex);

                //for men only
                if (userSex === '1') {
                    log.info("Man connected to videoDate with id "+id);
                    io.sockets.in(userId).emit('credits left', {'tokens': user_tokens[userId]})
                }
            }
            else if (data.type = 'videoAnonWindow') {
                log.warn("admin started video-spy page");
            }
        });

        socket.on('ask for dating', function (data) {
            log.warn("Someone asks for dating");
            const _data = {};
            const address = data.user_id ? data.user_id : userId;
            io.sockets.in(address).emit('video date appointment invitation', _data)
        });

        socket.on('someone accepted video date', function (data) {
            log.warn('Someone accepted video date');
            let user_id = data.who.toString();//user_id
            let from_whom = data.from.toString();//inviter

            actual_dates._modyfing = new Promise(getAllDates);
            io.sockets.in(from_whom).emit('video date acceptance', {'user_id': user_id})
        });

        socket.on('someone refused video date', function (data) {
            log.warn('Someone refused video date ', data);
            const who = data.who.toString();
            const from_whom = data.from.toString();

            concrete_user_dates[who].actual = false;
            concrete_user_dates[from_whom].actual = false;

            io.sockets.in(from_whom).emit('video date refusement', {'user_id': who});

            //man wants tokens back!
            const man_id = userSex === "1" ? userId : from_whom;
            const woman_id = userSex === "2" ? userId : from_whom;

            const _data = {
                'user_id': man_id,
                'tokens': rateChatType[4],
                'woman_id': woman_id
            };

            //db operations
            returnTokens(_data)
        });

        socket.on('someone changed video date time', function (data) {
            log.warn('Someone changed video date ');
            const who = data.who.toString();
            const from_whom = data.from.toString();


            concrete_user_dates[who] = concrete_user_dates[who] ? concrete_user_dates[who] : {};
            concrete_user_dates[from_whom] = concrete_user_dates[from_whom] ? concrete_user_dates[from_whom] : {};

            concrete_user_dates[who].actual = false;
            concrete_user_dates[from_whom].actual = false;

            io.sockets.in(from_whom).emit('video date changed', {'user_id': who});
        });

        socket.on('request for date beginning', function (data) {
            log.info('Opening user\'s videodate window');

            if (videodates_windows[userId]===undefined ||
                videodates_windows[userId].length === 0) {
                openVideodateWindow(data, userId, userSex);
            }
        });

        //data manipulation on video_date start
        socket.on('video started', function (room) {

            if (room===undefined)
                return;

            roomDataObject[room] = roomDataObject[room]===undefined ? roomDataObject[room] : {};

            //check for done videodate
            if (roomDataObject[room].dateEnd) {
                log.error('Videodate is already ended!');
                socket.emit('close this connection', {'room': room});
                return;
            }

            //check for videodate in process
            if (roomDataObject[room].timersSet) {
                return;
            }

            log.info('Video started in room ' + room);


            current_partners[room] = current_partners[room]===undefined ? current_partners[room] : [];


            if (current_partners[room].contains(userId))
                return;

            current_partners[room].push(userId);

            /*Remind another partner that date in process!*/
            let _room_obj = {};
            _room_obj.iter = 0;//how many times to remind about videodate
            _room_obj.room = room;


            //TODO check code
            //remind about
            let _timer = setInterval(function () {
                //check for max iterations count or videodate in process
                if (_room_obj.iter > 5 || roomDataObject[_room_obj.room].timersSet) {
                    clearInterval(_timer);
                    return;
                }
                _room_obj.iter++;

                if (current_partners[_room_obj.room].length < 2 && !roomDataObject[_room_obj.room]._modyfing)
                    if (roomDataObject[_room_obj.room].man && roomDataObject[_room_obj.room].man.user_id === userId) {
                        let _data = {};
                        _data.partner = roomDataObject[_room_obj.room].man;
                        _data.room = _room_obj.room;
                        // console.log('emitted waiting');
                        // console.log(roomDataObject[_room_obj.room].woman.user_id);
                        if (roomDataObject[_room_obj.room].woman)
                            io.sockets.in(roomDataObject[_room_obj.room].woman.user_id).emit('user is waiting for you in videodate', _data)
                    }
                    else {
                        let _data = {};
                        _data.partner = roomDataObject[_room_obj.room].woman;
                        _data.room = _room_obj.room;
                        // console.log('emitted waiting');
                        // console.log(roomDataObject[_room_obj.room].man.user_id);
                        if (roomDataObject[_room_obj.room].man)
                            io.sockets.in(roomDataObject[_room_obj.room].man.user_id).emit('user is waiting for you in videodate', _data)
                    }

                //check for full room
                if (current_partners[_room_obj.room].length > 1) {
                    clearInterval(_timer);
                    //clearInterval(this);
                }
            }, 30 * 1000);//every 30 sec

            //
            if (current_partners[room].length > 1) {
                for (let i in current_partners[room])
                    io.sockets.in(current_partners[room][i]).emit('start timer');
                const _data = {};
                let man_id;
                let woman_id;

                /*resolve who is who*/
                if (userSex === '1') {
                    man_id = userId;
                    for (let i in current_partners[room])
                        if (current_partners[room][i] !== man_id) {
                            woman_id = current_partners[room][i];
                            break;
                        }
                }
                else {
                    woman_id = userId;
                    for (let i in current_partners[room])
                        if (current_partners[room][i].toString() !== woman_id) {
                            man_id = current_partners[room][i];
                            break;
                        }
                }
                _data.reciver_id = woman_id;
                _data.sender_id = man_id;
                _data.message = '';
                _data.reciver_sex = '2';
                _data.chat_type = '4';//CONST VALUE
                _data.room = room;

                //db notice
                logCommStart(_data);

                //notify administration!
                admin_sockets_server.emit('vdate in process', _data);
                roomDataObject[room].timersSet = true;

                setTimeout(function () {
                    //debugger;
                    //if still in room - try to eat extra tokens!
                    if (current_partners[_data.room].length > 1) {
                        log.warn("eatExtraRoomTokens in room "+_data.room);
                        eatExtraRoomTokens(_data.room);//firing firs extra token eating iteration
                    }
                    else {
                        //debugger;
                        logCommEnd(_data.room);
                        for (let k in current_partners[_data.room]) {
                            io.sockets.in(current_partners[_data.room][k]).emit('close this connection', {'room': _data.room});
                        }
                        //clearInterval(main_timer);
                        return;
                    }

                    //console.log('WE ARE GOING FURTHER ! CAUSE WE HAVE MONEY!!!!');
                    //firing eating extra tokens eating process

                    let extra_timer = setInterval(function () {

                        if (current_partners[_data.room].length <= 1) {
                            //if it was not closed!
                            logCommEnd(_data.room);

                            if (!roomDataObject[_data.room].dateEnd)
                                for (let i in current_partners[_data.room]) {
                                    //clearInterval(this);
                                    io.sockets.in(current_partners[_data.room][i]).emit('close this connection', {'room': _data.room})
                                }
                            clearInterval(extra_timer);
                            return;
                        }
                        eatExtraRoomTokens(_data.room);
                    }, MONITOR_ROOM_TOKENS_INTERVAL);	//every minute	60*1000
                }, TIME_FOR_VIDEO_DATE);
            }
        });

        socket.on('disconnect', () => {
            if (referer && referer.match(/videodate/gi)) {
                videodates_windows[userId]=videodates_windows[userId]-1;

                for (let i in current_partners) {
                    let index = current_partners[i].indexOf(userId);

                    if (index > -1) {
                        current_partners[i].splice(index, 1);
                    }
                }
            }
        })
    });

//exra paths for CRON
    app.post('/remind_videodates', (req, res) => {
        //user_id - is only men's ids
        let _q = "select json_agg(row_to_json(q)) as data \
		from (select service_order_id::text, user_id, view_user_id, user_status, date_create, \
		type, message, time_zone, date_destination, time_period, contact_phone, \
		alternate_contact_phone, contact_email, manager_status, view_user_status,\
		view_user_delete_flag, user_delete_flag, credit_id, user_saw, \
			view_user_saw from public.user_service_order where type=3 and view_user_status=3 and date_destination>=(now()::date-interval'1 day'))q";

        client.query(_q, function (err) {
            if (err) {
                console.log('datesServer.js p 643');
                console.log(err);
            }
        })
            .on('error', function (err) {
                console.log('Error during query permChat 456 ', err);
                delete actual_dates._modyfing;
                resolve();
            })
            .on('row', function (row) { //we have only one row!
                var data = row.data;
                var now = new Date();
                var now_time_zone = now.getTimezoneOffset();
                var nowNativeZone = now.getTime();//не нужно менять!

                for (let i in data) {
                    if (!data.hasOwnProperty(i))
                        continue;
                    let _timeout = 0;//minutes
                    let datingDate = new Date(data[i].date_destination);//äåíü
                    let time_zone_orderer = -60 * parseInt(data[i].time_zone)//parseFoleat??;//+120/-120
                    let _start = data[i].time_period;

                    let _start_hours = _start.split(':')[0];
                    let _start_minutes = _start.split(':')[1];
                    //ТУТ ВСЕ РАБОТАЕТ! ничего менять нельзя!
                    let ordDateNativeZone = datingDate.getTime() + (2 * now_time_zone - time_zone_orderer) * 60 * 1000 + _start_hours * 60 * 60 * 1000 + _start_minutes * 60 * 1000;//надо отнять наше время и добавить его время

                    _timeout = Math.ceil((ordDateNativeZone - nowNativeZone) / 1000 / 60 / 60);//mins

                    if (_timeout == 30 || _timeout == 60 || _timeout == 15 || _timeout == 5 || _timeout == 2) {
                        io.sockets.in(/*MAN_ID*/data[i].user_id).emit('videodate reminder', _timeout);
                    }
                }
                res.status(200).end();
            })
    });

};//exports

function sendActualPartnerInfo(user_id, sex) {
    console.log('sendActualPartnerInfo function');
    if (!establish_connection[user_id])
        return;
    var room = establish_connection[user_id].data;
    console.log('room');
    console.log(room);

    var _data = {};
    _data.room = room;
    _data.user_id = user_id;
    _data.sex = sex;

    roomDataObject[_data.room] = roomDataObject[_data.room] ? roomDataObject[_data.room] : {};
    roomDataObject[_data.room]._modyfing = roomDataObject[_data.room]._modyfing ? roomDataObject[_data.room]._modyfing : Promise.resolve();
    getPartnerInfo(_data.room);
    roomDataObject[_data.room]._modyfing.then(() => {
        delete roomDataObject[_data.room]._modyfing;
        if (_data.sex == '1')
            io.sockets.in(_data.user_id).emit('partner actual data', roomDataObject[_data.room].woman);
        else
            io.sockets.in(_data.user_id).emit('partner actual data', roomDataObject[_data.room].man);
    })
}

function sendRoomToOpen(user_id, sex) {
    console.log('sendRoomToOpen function');
    if (!establish_connection[user_id])
        return;
    establish_connection[user_id]._modifying = establish_connection[user_id]._modifying ? establish_connection[user_id]._modifying : Promise.resolve();
    establish_connection[user_id]._modifying.then(() => {

        var room = establish_connection[user_id].data;
        delete establish_connection[user_id]._modifying;

        actual_dates._modyfing = actual_dates._modyfing ? actual_dates._modyfing : Promise.resolve();

        actual_dates._modyfing.then(() => {
            delete actual_dates._modyfing;
            var _timeout = 0;
            var data = actual_dates.data;
            for (let i in data) {
                if (data[i].service_order_id && data[i].service_order_id == room) {
                    var now = new Date();
                    var datingDate = new Date(data[i].date_destination);//from db
                    var now_time_zone = now.getTimezoneOffset();
                    var time_zone_orderer = -60 * parseInt(data[i].time_zone);//if only integer numbers available
                    var _start = data[i].time_period;
                    var _start_hours = _start.split(':')[0];
                    var _start_minutes = _start.split(':')[1];
                    _timeout = datingDate.getTime()
                        + (2 * now_time_zone - time_zone_orderer) * 60 * 1000
                        + _start_hours * 60 * 60 * 1000
                        + _start_minutes * 60 * 1000 - now.getTime();
                    break;
                }
            }

            //if we are late!
            console.log(_timeout >= -10 * 60 * 1000 && _timeout <= 0);
            console.log(_timeout < -10 * 60 * 1000);
            if (_timeout >= -10 * 60 * 1000 && _timeout <= 0)
                _timeout = 1500;


            else if (_timeout < -10 * 60 * 1000) {
                setTimeout(function () {
                    io.sockets.in(user_id).emit('close this connection', {'force': true});
                }, 1500);
                return;
            }
            console.log('timeout');
            console.log(_timeout);
            //_timeout=5000;

            setTimeout(function () {
                //debugger;
                io.sockets.in(user_id).emit('connect to the room', room)
            }, _timeout);
        })
    })
}

function getChatRate() {
    var _q = 'select row_to_json(q) from (select * from public.finance_service_type)q'
    var query = client.query(_q);

    query.on('row', (row) => {
        //fullRateType=row;
        for (var i in row) {
            rateChatType[row[i].service_type] = row[i].price_per_unit;
        }

    })
        .on('error', (err) => {
            console.log('dateServerHTTPS p 12312')
            console.log(err)
        })
}

function getPartnerInfo(room) {
    console.log('getPartnerInfo function');
    roomDataObject[room] = roomDataObject[room] ? roomDataObject[room] : {};
    roomDataObject[room]._modyfing = new Promise((resolve, reject) => {
        var _q = "select  json_agg(row_to_json(q)) \
		from (select u.user_id::text,sex::text,firstname::text from user_profile u,\
		lateral(select user_id,view_user_id from user_service_order where service_order_id='" + room + "')q \
		where u.user_id=q.user_id or u.user_id=q.view_user_id)q";

        console.log(_q);

        client.query(_q, function (err) {
            if (err) {
                //client.end();
                console.log('Error datesServerHtttps 530')
                console.log(err);
                delete roomDataObject[room]._modyfing;
                resolve();
            }
        })
            .on('row', function (row) {
                for (var i in row.json_agg) {
                    if (row.json_agg[i].sex == "1") {
                        roomDataObject[room].man = row.json_agg[i];
                    }
                    else {
                        roomDataObject[room].woman = row.json_agg[i]
                    }
                }
            })

            .on('end', function () {
                //client.end()
                delete roomDataObject[room]._modyfing;
                resolve();
            })
    });
}
//======FUNCTION TO WORK WITH DB
function eatExtraRoomTokens(room) {
    if (roomDataObject[room].dateEnd) {
        console.log('some other part closed videodate!');
        return
    }
    console.log('eatExtraRoomTokens function')
    console.log(typeof(room));
    console.log(room);

    const TYPE_EXTRA_VMIN = 19
    console.log('function monitorRoomTokens')

    user_tokens.actual = user_tokens.actual ? user_tokens.actual : Promise.resolve();
    user_tokens.actual.then(function () {
        //delete user_tokens.actual;
        //determine man_id in room
        var man_id;
        var woman_id;
        var balance;
        console.log(current_partners[room]);
        for (let i in current_partners[room]) {
            var uid = current_partners[room][i];
            if (typeof(user_tokens[uid]) != 'undefined') {
                man_id = uid;
                balance = user_tokens[uid];
            }
            else {
                woman_id = uid;
            }
        }

        if (balance < rateChatType[TYPE_EXTRA_VMIN]) {
            //tokens is over!!!!!!
            console.log(current_partners[room]);
            console.log('closing connection');
            // debugger
            logCommEnd(room);
            for (let i in current_partners[room]) {
                console.log('close this connection', current_partners[room][i]);
                io.sockets.in(current_partners[room][i]).emit('close this connection', {'room': room});
            }
        }
        else {
            io.sockets.in(man_id).emit('credits left', {'tokens': (balance - rateChatType[TYPE_EXTRA_VMIN])});

            io.sockets.in(man_id).emit('videodate for additional money', {'room': room});
            console.log('users data inside additional tokens eating');

            var _data = {
                'user_id': man_id,
                'room': room,
                'tokens': rateChatType[TYPE_EXTRA_VMIN],
                'woman_id': woman_id
            };
            console.log(_data);
            eatToken(_data);
        }
    })
}

function returnTokens(data) {
    console.log('fucntion returnTokens');

    var user_id = data.user_id;
    var room = data.room;
    var tokens = data.tokens;
    var woman_id = data.woman_id;

    var _q = "INSERT INTO public.user_credit(\
				men_id, women_id, credit, credit_type, service_type,count)\
		VALUES ('" + user_id + "','" + woman_id + "','" + tokens + "','5','3','" + tokens + "')";

    console.log(_q);

    client.query(_q, function (err, result) {
        if (err) {
            console.log('error during query p3451');
            console.log(err);
        }
    })
        .on('end', function () {
        });
}
function eatToken(data) {
    console.log('fucntion eatToken');
    console.log(data);
    var user_id = data.user_id;
    var room = data.room;
    var tokens = data.tokens;
    var woman_id = data.woman_id;

    var _q = "INSERT INTO public.user_credit(\
				men_id, women_id, credit, credit_type, service_type,count)\
		VALUES ('" + user_id + "','" + woman_id + "','" + tokens + "','2','3','" + tokens + "')";

    console.log(_q);

    client.query(_q, function (err, result) {
        if (err) {
            console.log('error during query p331');
            console.log(err);
            //in case of error
            if (room) {
                logCommEnd(room);
                for (let i in current_partners[room]) {
                    io.sockets.in(current_partners[room][i]).emit('close this connection', {'room': room});
                }
            }

        }
    })
        .on('end', function () {
        })

}

function openVideodateWindow(data, user_id, sex) {
    console.log('function openVideodateWindow');

    establish_connection._modifying = new Promise((resolve, reject) => {
        console.log({data : concrete_user_dates[user_id].data})
        for (var i in concrete_user_dates[user_id].data) {
            if (concrete_user_dates[user_id].data[i].service_order_id == data.date_id) {
                establish_connection[user_id] = establish_connection[user_id] ? establish_connection[user_id] : {};
                establish_connection[user_id].data = data.date_id;
                //check date actuality
                if (concrete_user_dates[user_id].data[i].chat_status == 3 || roomDataObject[data.date_id] && roomDataObject[data.date_id].dateEnd) {
                    io.sockets.in(user_id).emit('this videodate is not actual anymore');
                    return;
                }

                var _data = {'sex': sex};
                console.log('open videodate window dlskhfkdjhflkh');
                io.sockets.in(user_id).emit('open videodate window', _data);
                delete establish_connection[user_id]._modifying;
                resolve();
                break;
            }
        }
    })
}

function sendActualTimers(user_id, sex) {//id sex
    console.log('sendActualTimers fucntion');
    var data_for_send = [];
    concrete_user_dates[user_id] = concrete_user_dates[user_id] ? concrete_user_dates[user_id] : {};

    actual_dates._modyfing = actual_dates._modyfing ? actual_dates._modyfing : Promise.resolve();
    actual_dates._modyfing.then(function () {
        console.log({actual_dates});
        concrete_user_dates[user_id].actual = false;
        for (let i in actual_dates.data) {

            if (actual_dates.data[i].user_id == user_id
                || actual_dates.data[i].view_user_id == user_id) {
                data_for_send.push(actual_dates.data[i])
            }
        }

        delete actual_dates._modyfing;

        io.sockets.in(user_id).emit('actual data for user', data_for_send);
        concrete_user_dates[user_id].data = data_for_send;
        concrete_user_dates[user_id].actual = true;
    })
}
//getting all dates in database (1 day back max) (if we in -12 GMT)
function getAllDates(resolve, reject) {
    console.log('GET ALL DATES')
    console.log('GET ALL DATES')
    console.log('GET ALL DATES')
    console.log('GET ALL DATES')
    console.log('GET ALL DATES')
    var _q = "select json_agg(row_to_json(q)) as result \
		from (select service_order_id::text, user_id, view_user_id, user_status, date_create, \
type, message, time_zone, date_destination, time_period, contact_phone, \
alternate_contact_phone, contact_email, manager_status, view_user_status,\
view_user_delete_flag, user_delete_flag, credit_id, user_saw, \
view_user_saw from public.user_service_order where type=3 and view_user_status=2 "+/*and date_destination>=(now()::date-interval'1 day')*/")q";

    client.query(_q, function (err) {
        if (err) {
            console.log('datesServer.js p 643');
            console.log(err);
        }
    })
        .on('error', function (err) {
            console.log('Error during query permChat 333 ', err);
            delete actual_dates._modyfing;
            resolve();
        })
        .on('row', function (row) { //we have only one row!

            console.log('DATESERVER', {row})
            actual_dates.data = row.result;
        })

        .on('end', function () {
            delete actual_dates._modyfing;
            resolve();
        })
}
//DB LOGGER for start
function logCommStart(data) {
    console.log('logLiveChatStrat');

    var reciver_id = data.reciver_id,
        sender_id = data.sender_id,
        reciver_sex = data.reciver_sex,
        message = data.message,
        chat_type = data.chat_type,
        user_chat_call_id = data.room;
    var sender_sex = reciver_sex == 1 ? 2 : 1;

    var _q = "INSERT INTO public.user_chat_call(\
		user_chat_call_id,from_user, to_user, message, view_flag,  \
		chat_type, sex_sender,chat_status,end_date)\
VALUES ('" + user_chat_call_id + "','" + sender_id + "', '" + reciver_id + "', '" + message + "', false, '" + chat_type + "', \
		'" + sender_sex + "','2',null);";

    console.log(_q);

    client.query(_q, function (err) {

    })
        .on('end', function () {
        })

        .on('error', (err) => {
            console.log(err)
        })

}
//DB LOGGER for end
function logCommEnd(room) {
    console.log('logCommEnd');
    var _q = "UPDATE public.user_chat_call\
			SET end_date=now(),chat_status='3'\
			WHERE user_chat_call_id='" + room + "' and chat_status='2';";
    console.log(_q);

    client.query(_q, function (err) {
        if (err) {
            console.log('logCommEnd error ')
            console.log(err)
            roomDataObject[room].dateEnd = false;
        }
    })
        .on('error', (err) => {
            console.log(err)
        })
        .on('end', function () {
            roomDataObject[room].dateEnd = true;
        });
}
