"use strict";

var fs = require('fs');
var tls = require('tls');
var pg = require('pg');
var io;
var listOfBroadcasts = {};
var conString;//global connection string
var client;//global db client

//данные отправляются при запросе актуальеных данных
var possUsersObj = {};//id -> possible partners(not submited and not denied yet);
var usersOnline = {};//'uid':[true/false]; список пользователей онлайн

//пары собеседников
var currentSpeacker = {};//связный объект пользователь- пользователи [кто] [с кем];

var currnetVideoSpeakers = {};//по сути это одно и тоже что realVideoPartners, но!!!!
//realVideoPartners- это те между кем 100% уже установлена видео связь, а currnetVideoSpeakers это все тем между кем она либо установлена либо устанавливается!

//статус собеседников
var currentSpeackerStatus = {};//связный объект пользователь- пользователи со статусом!  1-ожидание первого сообщения! 2-чатятся! 3- чат не активный!
var currentVideoSpeackerStatus = {};//связный объект пользователь- пользователи со статусом!  1-ожидание первого сообщения! 2-чатятся! 3- чат не активный!

//сообщения
var chatPairsMessages = {};//по принципу [кому][от кого]
var videoChatPairsMessages = {};//по принципу [кому][от кого]

var chatWindows = {};//список открытых чат окон
var browserWindow = {};//список открытых окон браузера

//так как в сессии записан только начальный статус вебкамеры - будем мониторить изменение статуса веб камеры используя сокеты!
var webCamStatus = {};//[uid]=true/false

var cookieParser = require('cookie-parser')();
var session = require('cookie-session')({secret: 'securedsession'});

//те, у кого сейчас видеочат
var realVideoPartners = {};//[Ж][М]
var esstabConnecVideoPartners = {};//ДИНАМИЧЕСКИ ИЗМЕНЯЕМЫЙ ОБЪЕКТ, КОТОРЫЙ ПОКАЗЫВАЕТ , МЕЖДУ КОТОРЫМИ ПОЛЬЗОВАТЕЛЯМИ СЕЙЧАС НУЖНО УСТАНОВИТЬ ВИДЕОСВЯЗЬ!
var womenCamStreaming = {};//[Ж] :true/false //показывает , идет ли стрим камеры в видеочате уже кому-то!
var setPartnerId = {};

const TOKENS_EAT_PERIOD = 1000 * 60;

//[men_id]:timer
var chargesIntervals = {};//таймери що кожні TOKENS_EAT_PERIOD секунд хавають гроші з рахунку

//динамически обновлять данные о счете мужика, ибо много модулей, кроме этого могут хавать его деньги!
//[men_id]:tokens
var user_tokens = {};

//на странице чата мы не сможем ничего сделать пока он не пройдет проверку на баланс!
var allowedMansSockets = {};
//var videoEstablishTimers={};

var tokensFlowData = {};//динамически изменяемый объект для графика токенов на ХЕЛЕНЕ

//вся таблица finance_service_type
var fullRateType = {};
//цена услуг за определенное время
//[type]=price
var rateChatType = {};

var server;
//user avatars!
var userAvatars = {};//[uid][img_path]
//avatar checking period
const AVATAR_CHECK_PERIOD = 1000 * 60 * 60;//once per hour
//chat rate cheking period
const CHAT_RATE_CHECK_PERIOD = 1000 * 60 * 60;//once per hour

module.exports = function (share_obj) {
    var app = share_obj.app;
    user_tokens = share_obj.user_tokens;

    var parsedJSON = require(app.dir + '/config/configServer.json');
    var chatConf = parsedJSON.chat.helena;
    const HTTPORT = chatConf.server.portHTTP;
    var PORT = chatConf.server.portHTTPS;//порт сервера
    conString = 'pg://' + chatConf.dataBase.admin + ':' + chatConf.dataBase.pass + '@' + chatConf.dataBase.host + ':' + chatConf.dataBase.port + '/' + chatConf.dataBase.dbname;

    //подключаем client
    client = new pg.Client(conString);
    client.connect();

    server = require('https').createServer(app.secureOptions, app);
    const serverHttp = require('http').createServer(app).listen(HTTPORT);
    io = require('socket.io').listen(server);
    io.attach(serverHttp);
    //io = io.listen(server);

    io.set("transports", ["xhr-polling", "polling", 'websocket']);
    //io.set("polling duration", 10);

    //шарим сокетам данные пасспорта
    io.use(function (socket, next) {
        var req = socket.handshake;
        var res = {};
        cookieParser(req, res, function (err) {
            if (err) return next(err);
            session(req, res, next);
        });
    });
    const serverListenHandler = function () {
        console.log('chat server listening at ' + PORT);
        var promise = new Promise(function (resolve/*,reject*/) {
            getAllPossiblePartners(resolve);
            //console.log('chat monit start')	;
            //resolve();
        });

        //starting avatar monitoring
        getUsersAvatars();
        setInterval(getUsersAvatars, AVATAR_CHECK_PERIOD);

        //starting chat rate monitoring
        getChatRate();
        setInterval(getChatRate, CHAT_RATE_CHECK_PERIOD);

        promise.then(function () {
            io.sockets.on('connection', function (socket) {
                //создание комнаты для отдельного пользователя
                try {
                    var referer = socket.request.headers.referer;
                    var user_id = socket.handshake.session.passport.user.user_id.toString();
                    var sex = socket.handshake.session.passport.user.sex.toString();
                    var user_name = socket.handshake.session.passport.user.firstname.toString();
                }
                catch (e) {
                    console.log('Proaabably someone loaded login page!1');
                    console.log(e);
                }

                //флаг стрима вебкамеры! ('flase' is for nobody watching her now)
                if (sex === '2')
                    womenCamStreaming[user_id] = false;

                socket.on('id event', function (data) {
                    //отсылаем идетнификационные данные
                    try {
                        //можно вынести выше
                        var user_lang = socket.handshake.session.passport.user.lang;
                        var _data = {'name': user_name, 'sex': sex, 'lang': user_lang};

                        socket.emit('your data', _data);

                        var uid = socket.handshake.session.passport.user.user_id.toString();
                    }
                    catch (e) {
                        console.log('Probably someone has opened login page!2');
                        return;
                    }
                    if (typeof(uid) == 'undefined') {
                        console.log('start page');
                        return;
                    }
                    socket.join(uid);
                    //если женщина или флаг true (для мужчин)
                    if (sex === '2')
                        io.sockets.in(uid.toString()).emit('access is allowed');
                    else {
                        if (user_tokens[user_id] < 0) {
                            io.sockets.in(user_id).emit('recharge your account');
                        }
                        //доступ к каким-то сервисам блокируется
                        if (allowedMansSockets.actual)
                            allowedMansSockets.actual.then(function () {
                                if (typeof(allowedMansSockets) != 'undefined' && allowedMansSockets[uid] <= 0) {
                                    io.sockets.in(user_id).emit('close socket because of tokens absence');
                                }
                            });
                        else if (typeof(allowedMansSockets) != 'undefined' && allowedMansSockets[uid] <= 0) {
                            io.sockets.in(user_id).emit('close socket because of tokens absence');
                        }
                    }
                    //отправляем идентификационный код пользователя
                    //выставляем статус камеры
                    console.log('webCamStatus');
                    webCamStatus[uid] = socket.handshake.session.passport.user.web_camera_status == 2;
                    console.log(socket.handshake.session.passport.user.web_camera_status);
                    console.log(webCamStatus);

                    if (data.type == 'chat') {
                        chatWindows[uid] = chatWindows[uid] ? chatWindows[uid] : {};

                        if (!chatWindows[uid].amount)
                            chatWindows[uid].amount = 0;

                        if (chatWindows[uid]._modifying) {
                            chatWindows[uid]._modifying.then(function () {
                                chatWindows[uid]._modifying = new Promise(function (resolve, reject) {
                                    ++chatWindows[uid].amount;
                                    if (chatWindows[uid] && chatWindows[uid].amount == 1) {
                                        for (var i in possUsersObj) {
                                            for (var j in possUsersObj[i].data) {
                                                if (!possUsersObj[i].data.hasOwnProperty(j))
                                                    continue;
                                                var user_id = possUsersObj[i].data[j].user_id.toString();
                                                if (user_id === uid.toString()) {
                                                    io.sockets.in(i).emit('some chat partner already in chat', {'uid': uid.toString()});
                                                }
                                            }
                                        }
                                    }
                                    delete chatWindows[uid]._modifying;
                                    resolve();
                                })
                            })
                        }
                        else {
                            chatWindows[uid]._modifying = new Promise(function (resolve, reject) {
                                ++chatWindows[uid].amount;

                                if (chatWindows[uid] && chatWindows[uid].amount == 1) {
                                    for (var i in possUsersObj) {
                                        for (var j in possUsersObj[i].data) {
                                            if (!possUsersObj[i].data.hasOwnProperty(j))
                                                continue;
                                            var user_id = possUsersObj[i].data[j].user_id.toString();
                                            if (user_id === uid.toString()) {
                                                io.sockets.in(i).emit('some chat partner already in chat', {'uid': uid.toString()});
                                            }
                                        }
                                    }
                                }
                                delete chatWindows[uid]._modifying;
                                resolve();
                            });
                        }
                    }
                    else if (data.type == 'browser') {

                        usersOnline[uid] = true;//список онлайн пользователей
                        browserWindow[uid] = browserWindow[uid] ? browserWindow[uid] : {};

                        if (!browserWindow[uid].amount) {
                            browserWindow[uid].amount = 0;
                            browserWindow[uid].sex = sex;
                        }
                        //при появление ПЕРВОЙ в своем роде странички пользователя
                        //отправляем на чатОкна с ним информацию о изменении статуса (онлайн)

                        if (browserWindow[uid]._modifying) {
                            browserWindow[uid]._modifying.then(function () {
                                browserWindow[uid]._modifying = new Promise(function (resolve) {
                                    ++browserWindow[uid].amount;
                                    for (var i in possUsersObj) {
                                        for (var j in possUsersObj[i].data) {
                                            if (!possUsersObj[i].data.hasOwnProperty(j))
                                                continue;
                                            var user_id = possUsersObj[i].data[j].user_id.toString();
                                            if (user_id === uid.toString()) {
                                                io.sockets.in(i).emit('some possible partner is already online', {'uid': uid.toString()});
                                            }
                                        }
                                    }
                                    delete browserWindow[uid]._modifying;
                                    resolve();
                                })
                            })
                        }
                        else {
                            browserWindow[uid]._modifying = new Promise(function (resolve, reject) {
                                ++browserWindow[uid].amount;
                                for (var i in possUsersObj) {
                                    for (var j in possUsersObj[i].data) {
                                        if (!possUsersObj[i].data.hasOwnProperty(j))
                                            continue;
                                        var user_id = possUsersObj[i].data[j].user_id.toString();
                                        if (user_id === uid.toString()) {
                                            io.sockets.in(i).emit('some possible partner is already online', {'uid': uid.toString()});
                                        }
                                    }
                                }
                                delete browserWindow[uid]._modifying;
                                resolve();
                            })
                        }
                    }
                });
                //отправляем информацию по запросу как о ВИДЕОЧАТЕ так и просто ЧАТЕ
                socket.on('get actual partners for chat window', function () {
                    console.log('get actual partners for chat window');
                    sendActualChatPartners(user_id);
                });

                socket.on('remove partner from chat list', function (data) {
                    console.log('remove partner from chat list');
                    var partner_id = data.partner_id;
                    var isVideo = false;
                    for (let i in possUsersObj[user_id].data) {
                        var uid = possUsersObj[user_id].data[i].user_id;
                        if (partner_id == uid) {
                            isVideo = possUsersObj[user_id].data[i].video;
                            possUsersObj[user_id].data.splice(i, 1);
                            sendActualChatPartners(user_id);
                            removePosiblePartner(user_id, partner_id);
                        }
                    }
                    data.id = partner_id;
                    data.video = !isVideo;
                    //код взят с эмита  communication type change
                    //поэтому тут что-то может казаться нелогичным
                    if (data.video) {
                        //закрываем все ливчаты!
                        console.log(currentSpeacker[user_id]);
                        currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];
                        var index = currentSpeacker[user_id].indexOf(data.id.toString());
                        currentSpeacker[user_id].splice(index, 1);

                        if (index > -1) {
                            console.log({'user_id': user_id});
                            io.sockets.in(data.id.toString()).emit('some chat partner finished chat', {'user_id': user_id});
                            var _data = {};
                            _data.user_closed_id = user_id;
                            _data.partner_to_out_id = data.id.toString();
                            _data.chat_type = '1';

                            logCommEnd(_data);

                            //stop eating tokens!
                            if (sex == '1')
                                stopTokensEatingTimer(user_id, data.id, '1');
                            else
                                stopTokensEatingTimer(data.id, user_id, '1');

                            currentSpeackerStatus [data.id][user_id].status = 3;
                            currentSpeackerStatus [user_id][data.id].status = 3;
                        }
                        console.log('some chat partner finished chat');
                        //т.к. в currentSpeacker данные заносятся зеркально!
                        currentSpeacker[data.id.toString()] = currentSpeacker[data.id.toString()] ? currentSpeacker[data.id.toString()] : [];
                        if (currentSpeacker[data.id.toString()])
                            index = currentSpeacker[data.id.toString()].indexOf(user_id);
                        else
                            index = -1;
                        currentSpeacker[data.id.toString()].splice(index, 1);
                        console.log('1cahnged to video from chat who ' + user_id + ' with whom ' + data.id);
                    }
                    else {//если был видео чат
                        //закрываем все видеочаты!
                        currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];
                        index = currnetVideoSpeakers[user_id].indexOf(data.id.toString());
                        currnetVideoSpeakers[user_id].splice(index, 1);

                        console.log('some video chat partner finished video chat');
                        //ЕСЛИ ПРЕЖДЕ ЕЩЕ НИКТО НЕ ЗАКОНЧИЛ
                        if (index > -1) {
                            io.sockets.in(data.id.toString()).emit('some video chat partner finished video chat', {'user_id': user_id});
                            _data = {};
                            _data.user_closed_id = user_id;
                            _data.partner_to_out_id = data.id.toString();
                            _data.chat_type = '3';
                            logCommEnd(_data);

                            if (sex == '1')
                                stopTokensEatingTimer(user_id, data.id, '3');
                            else
                                stopTokensEatingTimer(data.id, user_id, '3');

                            currentVideoSpeackerStatus [data.id][user_id].status = 3;
                            currentVideoSpeackerStatus [user_id][data.id].status = 3;
                        }

                        //т.к. в currnetVideoSpeakers данные заносятся зеркально!
                        var data_id = data.id.toString();
                        currnetVideoSpeakers[data_id] = currnetVideoSpeakers[data_id] ? currnetVideoSpeakers[data_id] : [];
                        index = currnetVideoSpeakers[data_id].indexOf(user_id);
                        currnetVideoSpeakers[data_id].splice(index, 1);

                        if (sex === '2') {
                            //закрыла подруг
                            realVideoPartners[user_id] = realVideoPartners[user_id] ? realVideoPartners[user_id] : [];
                            index = realVideoPartners[user_id].indexOf(data.id.toString());
                            if (index >= 0)
                                realVideoPartners[user_id].splice(index, 1);

                            console.log('realVideoPartners ', realVideoPartners[user_id].length);
                            if (realVideoPartners[user_id].length == 0) {
                                womenCamStreaming[user_id] = false;//стрима сейчас нет!
                                io.sockets.in(user_id).emit('close stream');//чисто для девушек
                            }

                            if (listOfBroadcasts[user_id]) {
                                listOfBroadcasts[user_id].broadcasters = {};//обновляем список
                                listOfBroadcasts[user_id].allusers = {};
                            }//обновляем список

                        }
                        else {
                            //закрыл мужик

                            for (let i in realVideoPartners)
                                for (let j in  realVideoPartners[i]) {
                                    console.log(realVideoPartners[i]);
                                    console.log(realVideoPartners[i][j]);
                                    if (i.toString() === data.id.toString() && realVideoPartners[i][j].toString() === user_id) {

                                        index = realVideoPartners[i].indexOf(user_id);

                                        realVideoPartners[i].splice(index, 1);//убераем пользователя

                                        console.log('after delete');
                                        console.log(realVideoPartners[i]);


                                        if (realVideoPartners[i].length == 0) {
                                            console.log('close stream ', i);
                                            io.sockets.in(i.toString()).emit('close stream');//чисто для девушек
                                            womenCamStreaming[i] = false;//ТАК КАК НИКТО НЕ МОНИТОРИТ ПОДРУГУ - ВІРУБАЕМ ЕЕ
                                            if (listOfBroadcasts[i]) {
                                                listOfBroadcasts[i].broadcasters = {};//обновляем список
                                                listOfBroadcasts[i].allusers = {};
                                            }
                                            console.log(listOfBroadcasts)
                                        }
                                        break;
                                    }
                                }
                            console.log(womenCamStreaming)
                        }
                    }
                });

                socket.on('message from chat', function (data) {
                    let CHAT_FINANCE_TYPE = 1;
                    if (sex == '1' && user_tokens[user_id] < rateChatType[CHAT_FINANCE_TYPE]) {
                        io.sockets.in(user_id).emit('recharge your account');
                        return;
                    }

                    console.log('message from chat ');
                    var user_sex = socket.handshake.session.passport.user.sex;

                    //обнуляем оба массива
                    currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];

                    var _simple_message = {};

                    _simple_message.firstname = socket.handshake.session.passport.user.firstname;
                    _simple_message.message = data.message;
                    _simple_message.create_date = new Date().toString();//в базе будет другое значение!

                    console.log({currentSpeaker : currentSpeacker[user_id]});
                    if (currentSpeacker[user_id].indexOf(data.id.toString()) != -1) {
                        //если есть в списке собеседников
                        //делаем список наших сообщений актуальным во избежания повторного запроса в базу
                        chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
                        chatPairsMessages[user_id][data.id] = chatPairsMessages[user_id][data.id] ? chatPairsMessages[user_id][data.id] : [];

                        chatPairsMessages[data.id] = chatPairsMessages[data.id] ? chatPairsMessages[data.id] : {};
                        chatPairsMessages[data.id][user_id] = chatPairsMessages[data.id][user_id] ? chatPairsMessages[data.id][user_id] : [];

                        chatPairsMessages[user_id][data.id].push(_simple_message);//[to whom] [from whom]

                        chatPairsMessages[data.id][user_id].push(_simple_message);//[to whom][from whom]

                        //запись в бд
                        logMessageSendAction(user_id, data.id, data.message, 1, 2);
                        var _data = {};
                        _data.message = data.message;
                        _data.firstname = socket.handshake.session.passport.user.firstname;
                        _data.user_id = socket.handshake.session.passport.user.user_id;
                        _data.create_date = new Date();
                        console.log('\n\n\n\n\n')
                        console.log(io.sockets.in(data.id));
                        console.log('\n\n\n\n\n')

                        io.sockets.in(data.id).emit('message from chat', _data);

                        if (user_sex.toString() === '2' && currentSpeackerStatus[user_id][data.id].status === 1) {
                            console.log('chat started');
                            _data = {};
                            _data.reciver_id = user_id;
                            _data.sender_id = data.id;
                            _data.message = data.message;
                            _data.reciver_sex = user_sex;
                            _data.chat_type = 1;//чат

                            logCommStart(_data);//data.id тот кто отправил сообщение
                            startTokensEatingTimer(data.id, user_id, 1);

                            currentSpeackerStatus[user_id][data.id].status = 2;
                            currentSpeackerStatus[data.id][user_id].status = 2;
                        }
                    }
                    else {//если нету в списке собеседников
                        //делаем список наших сообщений актуальным во избежания повторного запроса в базу

                        /*chatPairsMessages[user_id]={};
                         chatPairsMessages[user_id][data.id]=[];

                         chatPairsMessages[data.id]={};
                         chatPairsMessages[data.id][user_id]=[];*/

                        chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
                        chatPairsMessages[user_id][data.id] = chatPairsMessages[user_id][data.id] ? chatPairsMessages[user_id][data.id] : [];

                        chatPairsMessages[data.id] = chatPairsMessages[data.id] ? chatPairsMessages[data.id] : {};
                        chatPairsMessages[data.id][user_id] = chatPairsMessages[data.id][user_id] ? chatPairsMessages[data.id][user_id] : [];

                        chatPairsMessages[user_id][data.id].push(_simple_message);//[to whom] [from whom]
                        chatPairsMessages[data.id][user_id].push(_simple_message);//[to whom][from whom]
                        //запись в бд sms
                        logMessageSendAction(user_id, data.id, data.message, 1, 2, true);
                        //logging communication attempt to DB

                        logCommTry(user_id, data.id, data.message, /*CHAT_TYPE*/1, function (user_chat_call_id) {
                            _data = getSimpleUserAvatar(user_id);//{} || some data
                            _data.message = data.message;
                            _data.firstname = socket.handshake.session.passport.user.firstname;
                            _data.lastname = socket.handshake.session.passport.user.lastname;

                            _data.id = socket.handshake.session.passport.user.user_id;
                            _data.sex = socket.handshake.session.passport.user.sex;
                            _data.user_chat_call_id = user_chat_call_id;

                            io.sockets.in(data.id).emit('chat invitation message', _data);
                        });


                    }
                });

                //сообщение из откр
                socket.on('message from chat to all mans', function (data) {

                    var user_sex = socket.handshake.session.passport.user.sex;
                    var ids_buffer = [];
                    console.log('all men who have to get an invitation');
                    /*for(var i in browserWindow)
                     if(browserWindow[i].sex=='1'&&browserWindow[i].amount>0){
                     console.log(i);
                     }*/

                    for (var i in browserWindow)
                        if (browserWindow[i].sex == '1' && browserWindow[i].amount > 0) {
                            var partner_id = i;
                            //add user id to buffer for logging!
                            ids_buffer.push(i.toString());
                            //обнуляем оба массива
                            currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];
                            let _simple_message = {};
                            _simple_message.firstname = socket.handshake.session.passport.user.firstname;
                            _simple_message.message = data.message;
                            _simple_message.create_date = new Date().toString();//в базе будет другое значение!

                            if (currentSpeacker[user_id].indexOf(partner_id.toString()) != -1) {//если есть в списке собеседников
                                //делаем список наших сообщений актуальным во избежания повторного запроса в базу
                                chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
                                chatPairsMessages[user_id][partner_id] = chatPairsMessages[user_id][partner_id] ? chatPairsMessages[user_id][partner_id] : [];

                                chatPairsMessages[partner_id] = chatPairsMessages[partner_id] ? chatPairsMessages[partner_id] : {};
                                chatPairsMessages[partner_id][user_id] = chatPairsMessages[partner_id][user_id] ? chatPairsMessages[partner_id][user_id] : [];

                                chatPairsMessages[user_id][partner_id].push(_simple_message);//[to whom] [from whom]
                                chatPairsMessages[partner_id][user_id].push(_simple_message);//[to whom][from whom]

                                logMessageSendAction(user_id, partner_id, data.message, 1, 2);

                                var _data = {};
                                _data.message = data.message;
                                _data.firstname = socket.handshake.session.passport.user.firstname;
                                _data.user_id = socket.handshake.session.passport.user.user_id;
                                _data.create_date = new Date();
                                console.log('sent data to ', partner_id);
                                console.log(_data);

                                io.sockets.in(partner_id).emit('message from chat', _data);

                                if (currentSpeackerStatus[user_id][partner_id].status === 1) {
                                    console.log('chat started');
                                    //делаем список наших сообщений актуальным во избежания повторного запроса в базу
                                    /*chatPairsMessages[user_id]={};
                                     chatPairsMessages[user_id][partner_id]=[];

                                     chatPairsMessages[partner_id]={};
                                     chatPairsMessages[partner_id][user_id]=[];*/

                                    chatPairsMessages[user_id][partner_id].push(_simple_message);//[to whom] [from whom]
                                    chatPairsMessages[partner_id][user_id].push(_simple_message);//[to whom][from whom]

                                    _data = {};
                                    _data.reciver_id = user_id;
                                    _data.sender_id = partner_id;
                                    _data.message = data.message;
                                    _data.reciver_sex = user_sex;
                                    _data.chat_type = 1;//чат

                                    logCommStart(_data);
                                    startTokensEatingTimer(data.id, user_id, 1);
                                    currentSpeackerStatus[user_id][data.id].status = 2;
                                    currentSpeackerStatus[data.id][user_id].status = 2;
                                }
                            }
                            else {//если нету в списке собеседников
                                let _simple_message = {};

                                _simple_message.firstname = socket.handshake.session.passport.user.firstname;
                                _simple_message.message = data.message;
                                _simple_message.create_date = new Date().toString();//в базе будет другое значение!

                                chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
                                _data = getSimpleUserAvatar(user_id);//{} || some data
                                _data.message = data.message;
                                _data.firstname = socket.handshake.session.passport.user.firstname;
                                _data.lastname = socket.handshake.session.passport.user.lastname;

                                _data.id = socket.handshake.session.passport.user.user_id;
                                _data.sex = socket.handshake.session.passport.user.sex;
                                //расслыка
                                _data.spam = true;

                                console.log('chat invitation message');
                                io.sockets.in(partner_id).emit('chat invitation message', _data);
                            }

                        }

                    logSpamMessage(ids_buffer, user_id, data.message, /*isVideo*/false);
                });

                socket.on('message from video chat to all mans', function (data) {
                    console.log('message from video chat to all mans');
                    //////debugger
                    if (sex == '2') {
                        if (!webCamStatus[user_id]) {
                            socket.emit('webcam is off');
                            return;
                        }
                    }
                    //var user_sex=socket.handshake.session.passport.user.sex;
                    var ids_buffer = [];
                    console.log(currnetVideoSpeakers);
                    for (var i in browserWindow) {
                        if (browserWindow[i].sex == '1' && browserWindow[i].amount > 0) {
                            var partner_id = i;

                            //add user id to buffer for logging!
                            ids_buffer.push(i.toString());
                            //обнуляем оба массива
                            currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];

                            var _simple_message = {};

                            _simple_message.firstname = socket.handshake.session.passport.user.firstname;
                            _simple_message.message = data.message;
                            _simple_message.create_date = new Date().toString();//в базе будет другое значение!

                            //checking objects!
                            videoChatPairsMessages[user_id] = videoChatPairsMessages[user_id] ? videoChatPairsMessages[user_id] : {};
                            videoChatPairsMessages[user_id][partner_id] = videoChatPairsMessages[user_id][partner_id] ? videoChatPairsMessages[user_id][partner_id] : [];

                            videoChatPairsMessages[partner_id] = videoChatPairsMessages[partner_id] ? videoChatPairsMessages[partner_id] : {};
                            videoChatPairsMessages[partner_id][user_id] = videoChatPairsMessages[partner_id][user_id] ? videoChatPairsMessages[partner_id][user_id] : [];

                            //делаем список наших сообщений актуальным во избежания повторного запроса в базу
                            videoChatPairsMessages[user_id][partner_id].push(_simple_message);//[to whom] [from whom]
                            videoChatPairsMessages[partner_id][user_id].push(_simple_message);//[to whom][from whom]

                            console.log(currnetVideoSpeakers);

                            if (currnetVideoSpeakers[user_id].indexOf(partner_id) != -1) {//если есть в списке собеседников
                                //logMessageSendAction(user_id,partner_id,data.message,2,2);//первая 2-ка чат
                                var _data = {};
                                _data.message = data.message;
                                _data.firstname = socket.handshake.session.passport.user.firstname;
                                _data.user_id = socket.handshake.session.passport.user.user_id;
                                _data.create_date = new Date();
                                io.sockets.in(partner_id).emit('message from videochat', _data);
                                console.log(currentVideoSpeackerStatus);
                            }
                            else {//если нету в списке собеседников
                                //logMessageSendAction(user_id,partner_id,data.message,2,2,true);

                                _data = getSimpleUserAvatar(user_id);//{} || some data
                                _data.message = data.message;
                                _data.firstname = socket.handshake.session.passport.user.firstname;
                                _data.lastname = socket.handshake.session.passport.user.lastname;

                                _data.id = socket.handshake.session.passport.user.user_id;
                                _data.sex = socket.handshake.session.passport.user.sex;
                                _data.age = socket.handshake.session.passport.user.age;
                                _data.haircolor = socket.handshake.session.passport.user.haircolor;
                                _data.country = socket.handshake.session.passport.user.country;
                                _data.spam = true;

                                ////debugger;
                                io.sockets.in(partner_id).emit('video chat invitation message', _data);
                            }//inner else
                        }//for
                    }//if
                    //log spam message to DB
                    logSpamMessage(ids_buffer, user_id, data.message, /*isVideo*/true);
                });

                socket.on('change type of communication', function (data) {

                    if (sex == '1')
                        if (!webCamStatus[data.id]) {
                            io.sockets.in(user_id).emit('girl webcam is off');
                        }
                        else {
                            io.sockets.in(user_id).emit('change girl type of communication allowed', data)
                        }
                    else if (sex == '2') {
                        if (!webCamStatus[user_id]) {
                            io.sockets.in(user_id).emit('webcam is off');
                        }
                        else {
                            io.sockets.in(user_id).emit('change type of communication allowed', data)
                        }
                    }
                });

                socket.on('message from video chat', function (data) {
                    //проверка на наличие токенов у мужика
                    let CHAT_FINANCE_TYPE = 3;
                    if (sex == '1' && user_tokens[user_id] < rateChatType[CHAT_FINANCE_TYPE]) {
                        io.sockets.in(user_id).emit('recharge your account');
                        return;
                    }

                    if (sex == '2') {
                        if (!webCamStatus[user_id]) {
                            socket.emit('webcam is off');
                            return;
                        }
                    }

                    var user_sex = socket.handshake.session.passport.user.sex.toString();

                    if (sex == '1' && !webCamStatus[data.id]) {
                        //TODO if is in partner list - close communication
                        io.sockets.in(user_id).emit('girl webcam is off');
                        return;
                    }

                    currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];

                    var _simple_message = {};

                    _simple_message.firstname = socket.handshake.session.passport.user.firstname;
                    _simple_message.message = data.message;
                    _simple_message.create_date = new Date().toString();//в базе будет другое значение!

                    if (currnetVideoSpeakers[user_id].indexOf(data.id.toString()) != -1) {//если есть в списке собеседников
                        //делаем список наших сообщений актуальным во избежания повторного запроса в базу
                        videoChatPairsMessages[user_id] = videoChatPairsMessages[user_id] ? videoChatPairsMessages[user_id] : {};
                        videoChatPairsMessages[user_id][data.id] = videoChatPairsMessages[user_id][data.id] ? videoChatPairsMessages[user_id][data.id] : [];

                        videoChatPairsMessages[data.id] = videoChatPairsMessages[data.id] ? videoChatPairsMessages[data.id] : {};
                        videoChatPairsMessages[data.id][user_id] = videoChatPairsMessages[data.id][user_id] ? videoChatPairsMessages[data.id][user_id] : [];
                        videoChatPairsMessages[data.id][user_id].push(_simple_message);//[to whom][from whom]
                        videoChatPairsMessages[user_id][data.id].push(_simple_message);//[to whom] [from whom]

                        //запись в бд
                        logMessageSendAction(user_id, data.id, data.message, 2, 2);//первая 2-ка чат

                        var _data = {};
                        _data.message = data.message;
                        _data.firstname = socket.handshake.session.passport.user.firstname;
                        _data.user_id = socket.handshake.session.passport.user.user_id;
                        _data.create_date = new Date();
                        io.sockets.in(data.id).emit('message from videochat', _data);
                    }
                    else {//если нету в списке собеседников

                        //делаем список наших сообщений актуальным во избежания повторного запроса в базу

                        videoChatPairsMessages[user_id] = videoChatPairsMessages[user_id] ? videoChatPairsMessages[user_id] : {};
                        videoChatPairsMessages[user_id][data.id] = videoChatPairsMessages[user_id][data.id] ? videoChatPairsMessages[user_id][data.id] : [];

                        videoChatPairsMessages[data.id] = videoChatPairsMessages[data.id] ? videoChatPairsMessages[data.id] : {};
                        videoChatPairsMessages[data.id][user_id] = videoChatPairsMessages[data.id][user_id] ? videoChatPairsMessages[data.id][user_id] : [];
                        videoChatPairsMessages[data.id][user_id].push(_simple_message);//[to whom][from whom]
                        videoChatPairsMessages[user_id][data.id].push(_simple_message);//[to whom] [from whom]

                        //запись в бд
                        //logMessageSendAction(user_id,data.id,data.message,1,2);
                        logMessageSendAction(user_id, data.id, data.message, 2, 2, true);
                        //logging communicaton attempt
                        logCommTry(user_id, data.id, data.message, /*CHAT_TYPE*/3, function (user_chat_call_id) {
                            _data = getSimpleUserAvatar(user_id);//{} || some data
                            _data.message = data.message;
                            _data.firstname = socket.handshake.session.passport.user.firstname;
                            _data.lastname = socket.handshake.session.passport.user.lastname;
                            _data.id = socket.handshake.session.passport.user.user_id;

                            _data.sex = socket.handshake.session.passport.user.sex;
                            _data.age = socket.handshake.session.passport.user.age;
                            _data.haircolor = socket.handshake.session.passport.user.haircolor;
                            _data.country = socket.handshake.session.passport.user.country;
                            _data.user_chat_call_id = user_chat_call_id;

                            io.sockets.in(data.id).emit('video chat invitation message', _data);
                        });


                    }
                });

                socket.on('refuse chat invitation', function (data) {

                    var uid = socket.handshake.session.passport.user.user_id;
                    var username = socket.handshake.session.passport.user.firstname;
                    var _data = {};
                    _data.username = 'Server';
                    _data.message = username + ' refused your chatting invitation';
                    _data.user_id = uid;
                    io.sockets.in(data.id).emit('some partner refused chat invitation', _data);


                    currentSpeackerStatus [data.id] = currentSpeackerStatus [data.id] ? currentSpeackerStatus [data.id] : {};
                    currentSpeackerStatus [data.id][uid] = currentSpeackerStatus [data.id][uid] ? currentSpeackerStatus [data.id][uid] : {};

                    currentSpeackerStatus [uid] = currentSpeackerStatus [uid] ? currentSpeackerStatus [uid] : {};
                    currentSpeackerStatus [uid][data.id] = currentSpeackerStatus [uid][data.id] ? currentSpeackerStatus [uid][data.id] : {};

                    currentSpeackerStatus [data.id][uid].status = 3;//тот кто отослал отклоненную заяку
                    currentSpeackerStatus [uid][data.id].status = 3;//тот кто отклонил принятую заявку
                });

                socket.on('accept chat invitation', function (data) {
                    //checking fro spam
                    if (sex == '1' && data.spam) {
                        console.log('return because of spam flag!');
                        return;
                    }

                    currentSpeacker[data.id] = currentSpeacker[data.id] ? currentSpeacker[data.id] : [];
                    currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];

                    currentSpeacker[data.id].push(user_id.toString());
                    currentSpeacker[user_id].push(data.id.toString());

                    currentSpeackerStatus [data.id] = currentSpeackerStatus [data.id] ? currentSpeackerStatus [data.id] : {};
                    currentSpeackerStatus [data.id][user_id] = currentSpeackerStatus [data.id][user_id] ? currentSpeackerStatus [data.id][user_id] : {};

                    currentSpeackerStatus [user_id] = currentSpeackerStatus [user_id] ? currentSpeackerStatus [user_id] : {};
                    currentSpeackerStatus [user_id][data.id] = currentSpeackerStatus [user_id][data.id] ? currentSpeackerStatus [user_id][data.id] : {};

                    currentSpeackerStatus [data.id][user_id].status = 1;//чат в режиме ожидания первого сообщения//тот кто отправил
                    currentSpeackerStatus [user_id][data.id].status = 1;//тот кому отправили

                });

                socket.on('refuse video chat invitation', function (data) {
                    console.log('refuse video chat invitation');
                    //var user_id=socket.handshake.session.passport.user.user_id;
                    var username = socket.handshake.session.passport.user.firstname;
                    var _data = {};
                    _data.username = 'Server';
                    _data.message = username + ' refused your VIDEO chat invitation';
                    _data.user_id = user_id;
                    io.sockets.in(data.id).emit('some partner refused videochat invitation', _data);


                    currentVideoSpeackerStatus [data.id] = currentVideoSpeackerStatus [data.id] ? currentVideoSpeackerStatus [data.id] : {};
                    currentVideoSpeackerStatus [data.id][user_id] = currentVideoSpeackerStatus [data.id][user_id] ? currentVideoSpeackerStatus [data.id][user_id] : {};

                    currentVideoSpeackerStatus [user_id] = currentVideoSpeackerStatus [user_id] ? currentVideoSpeackerStatus [user_id] : {};
                    currentVideoSpeackerStatus [user_id][data.id] = currentVideoSpeackerStatus [user_id][data.id] ? currentVideoSpeackerStatus [user_id][data.id] : {};

                    currentVideoSpeackerStatus [data.id][user_id].status = 3;//тот кто отослал отклоненную заяку
                    currentVideoSpeackerStatus [user_id][data.id].status = 3;//тот кто отклонил принятую заявку
                });

                socket.on('accept video chat invitation', function (data) {
                    var sex = socket.handshake.session.passport.user.sex.toString();

                    //checking for spam
                    if (sex == '1' && data.spam) {
                        return;
                    }
                    currnetVideoSpeakers[data.id] = currnetVideoSpeakers[data.id] ? currnetVideoSpeakers[data.id] : [];
                    currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];

                    currnetVideoSpeakers[data.id].push(user_id.toString());
                    currnetVideoSpeakers[user_id].push(data.id.toString());

                    currentVideoSpeackerStatus [data.id] = currentVideoSpeackerStatus [data.id] ? currentVideoSpeackerStatus [data.id] : {};
                    currentVideoSpeackerStatus [data.id][user_id] = currentVideoSpeackerStatus [data.id][user_id] ? currentVideoSpeackerStatus [data.id][user_id] : {};

                    currentVideoSpeackerStatus [user_id] = currentVideoSpeackerStatus [user_id] ? currentVideoSpeackerStatus [user_id] : {};
                    currentVideoSpeackerStatus [user_id][data.id] = currentVideoSpeackerStatus [user_id][data.id] ? currentVideoSpeackerStatus [user_id][data.id] : {};

                    currentVideoSpeackerStatus [data.id][user_id].status = 1;//чат в режиме ожидания первого сообщения//тот кто отправил
                    currentVideoSpeackerStatus [user_id][data.id].status = 1;//тот кому отправили

                    //после начала стрима этой Ж - отправить сообщение о начале стрима М
                    if (sex === '1') {//если принял предложение М
                        esstabConnecVideoPartners[data.id] = esstabConnecVideoPartners[data.id] ? esstabConnecVideoPartners[data.id] : {};

                        var _data = {'connected': false, 'user_id': user_id};
                        //уменьшаем кол-во кода
                        esstabConnecVideoPartners[data.id]._modifying = esstabConnecVideoPartners[data.id]._modifying ? esstabConnecVideoPartners[data.id]._modifying : Promise.resolve();
                        esstabConnecVideoPartners[data.id].data = esstabConnecVideoPartners[data.id].data ? esstabConnecVideoPartners[data.id].data : [];


                        esstabConnecVideoPartners[data.id]._modifying.then(() => {
                            esstabConnecVideoPartners[data.id]._modifying = new Promise((resolve/*,reject*/) => {
                                //debugger;
                                esstabConnecVideoPartners[data.id].data.push(_data);//добавляем М в список Ж
                                if (!womenCamStreaming[data.id]) {
                                    //чат окно на данный момент может еще не быть открыто!
                                    let timer = setInterval(function () {
                                        if (chatWindows[user_id] && chatWindows[data.id].amount > 0) {
                                            io.sockets.in(data.id).emit('start webcam streaming', {'broadcastid': (data.id.toString())});
                                            delete esstabConnecVideoPartners[data.id]._modifying;
                                            resolve();
                                            clearInterval(timer);
                                        }
                                    }, 500);
                                }
                                else {
                                    let timer = setInterval(function () {
                                        if (chatWindows[user_id] && chatWindows[user_id].amount > 0) {
                                            io.sockets.in(user_id).emit('join webcam stream', {'broadcastid': (data.id.toString())});
                                            delete esstabConnecVideoPartners[data.id]._modifying;
                                            resolve();
                                            clearInterval(timer);
                                        }
                                    }, 500);
                                }//else

                            })
                        })
                    }//if
                    else {//если приняла предложение Ж

                        esstabConnecVideoPartners[user_id] = esstabConnecVideoPartners[user_id] ? esstabConnecVideoPartners[user_id] : {};
                        esstabConnecVideoPartners[user_id].data = esstabConnecVideoPartners[user_id].data ? esstabConnecVideoPartners[user_id].data : [];

                        //МЕНЯЕМ ОБЪЕКТ ЗАДАЧИ ПОДКЛЮЧЕНИЙ

                        _data = {'connected': false, 'user_id': data.id.toString()};
                        //уменьшаем количество кода

                        esstabConnecVideoPartners[user_id]._modifying = esstabConnecVideoPartners[user_id]._modifying ? esstabConnecVideoPartners[user_id]._modifying : Promise.resolve();

                        esstabConnecVideoPartners[user_id]._modifying.then(() => {

                            esstabConnecVideoPartners[user_id]._modifying = new Promise((resolve, reject) => {
                                esstabConnecVideoPartners[user_id].data.push(_data);//добавляем М в список Ж
                                delete esstabConnecVideoPartners[user_id]._modifying;
                                resolve();
                            })
                        });

                        //проверяем включена ли камера
                        if (!womenCamStreaming[user_id]) {
                            //вероятно что у нее просто закрыто окно! поэтуму надо проверить не открыто ли оно?!
                            let timer = setInterval(function () {
                                if (chatWindows[user_id] && chatWindows[user_id].amount > 0) {
                                    //debugger;
                                    io.sockets.in(user_id).emit('start webcam streaming', {'broadcastid': (user_id.toString())});
                                    clearInterval(timer);
                                }
                            }, 500);
                        }
                        else {
                            //камера включена
                            let timer = setInterval(function () {
                                if (chatWindows[user_id] && chatWindows[data.id].amount > 0) {
                                    io.sockets.in(data.id).emit('start webcam streaming', {'broadcastid': (user_id.toString())});
                                    clearInterval(timer);
                                }
                            }, 500);

                        }
                    }
                });

                socket.on('add to chat', function (data) {
                    const CHAT_FINANCE_TYPE = 1;
                    var is_poor_man = false;

                    if (sex == '1' && user_tokens[user_id] < rateChatType[CHAT_FINANCE_TYPE])
                        is_poor_man = true;


                    var promise;
                    if (!chatWindows[user_id] || chatWindows[user_id].amount < 1)

                        promise = new Promise(function (resolve) {
                            var timer = setInterval(() => {
                                if (!(!chatWindows[user_id] || chatWindows[user_id].amount < 1)) {
                                    clearInterval(timer);
                                    resolve();
                                }
                            }, 750);
                        });
                    if (promise)
                        promise.then(() => {
                            if (chatWindows[user_id]._modifying) {
                                chatWindows[user_id]._modifying.then(() => {
                                    makeDataActual(data, user_id, false);
                                    if (is_poor_man) {
                                        io.sockets.in(user_id).emit('recharge your account');
                                        //return
                                    }
                                })
                            }
                            else {
                                makeDataActual(data, user_id, false);
                                if (is_poor_man) {
                                    io.sockets.in(user_id).emit('recharge your account');
                                    //return
                                }
                            }
                        });
                    else {
                        if (chatWindows[user_id]._modifying) {
                            chatWindows[user_id]._modifying.then(() => {
                                makeDataActual(data, user_id, false);
                                if (is_poor_man) {
                                    io.sockets.in(user_id).emit('recharge your account');
                                    //return
                                }
                            })
                        }
                        else {
                            makeDataActual(data, user_id, false);
                            if (is_poor_man) {
                                io.sockets.in(user_id).emit('recharge your account');
                                return
                            }
                        }
                    }
                });

                socket.on('add to video chat', function (data) {
                    const VCHAT_FINANCE_TYPE = 3;
                    //var user_id=socket.handshake.session.passport.user.user_id//requester
                    var user_name = socket.handshake.session.passport.user.firstname;
                    var is_poor_man = false;

                    if (sex == '1' && user_tokens[user_id] < rateChatType[VCHAT_FINANCE_TYPE]) {
                        is_poor_man = true;
                    }

                    var promise = new Promise(function (resolve, reject) {
                        var iter = 0;
                        var timer = setInterval(() => {
                            if (iter == 20) {
                                clearInterval(timer);
                                resolve();
                            }
                            if (chatWindows[user_id] && chatWindows[user_id].amount >= 1) {
                                clearInterval(timer);
                                resolve();
                            }
                            ++iter;
                        }, 500);
                    });


                    promise.then(() => {
                        chatWindows[user_id]._modifying = chatWindows[user_id]._modifying ? chatWindows[user_id]._modifying : Promise.resolve();
                        chatWindows[user_id]._modifying.then(() => {
                            makeDataActual(data, user_id, /*isVideo*/true);
                            if (is_poor_man) {
                                io.sockets.in(user_id).emit('recharge your account');
                            }
                        })
                    });

                });

                socket.on('change camera status', function () {
                    webCamStatus[user_id] = !webCamStatus[user_id];
                });

                //add to video chat can be locked on womenCamStreaming obj
                socket.on('webcam stream was started', function () {
                    womenCamStreaming[user_id] = true;

                    esstabConnecVideoPartners[user_id]._modifying = esstabConnecVideoPartners[user_id]._modifying ? esstabConnecVideoPartners[user_id]._modifying : Promise.resolve();
                    esstabConnecVideoPartners[user_id]._modifying.then(() => {
                        for (var i in esstabConnecVideoPartners[user_id].data) {

                            var index = i;
                            var manId = esstabConnecVideoPartners[user_id].data[index].user_id.toString();

                            //TODO работраться!
                            var isConnected = esstabConnecVideoPartners[user_id].data[index].connected;
                            if (isConnected)
                                continue;

                            let data = {};
                            data.index = i;
                            data.manId = manId;
                            data.user_id = user_id;
                            //окно М всегда в этот момент открыто!
                            io.sockets.in(manId).emit('join webcam stream', {'broadcastid': user_id});

                        }
                    })
                });

                //мужик подключился к стриму
                socket.on('has joined webcam stream', function (data) {
                    var womanId = data.broadcastid;

                    esstabConnecVideoPartners[womanId]._modifying = esstabConnecVideoPartners[womanId]._modifying ? esstabConnecVideoPartners[womanId]._modifying : Promise.resolve();
                    if (esstabConnecVideoPartners[womanId]._modifying) {
                        esstabConnecVideoPartners[womanId]._modifying.then(() => {
                            esstabConnecVideoPartners[womanId]._modifying = new Promise((resolve, reject) => {
                                for (var i = 0; i < esstabConnecVideoPartners[womanId].data.length; i++) {
                                    if (esstabConnecVideoPartners[womanId].data[i].user_id == user_id) {
                                        //debugger;
                                        esstabConnecVideoPartners[womanId].data.splice(i, 1);//добавляем М в список Ж
                                        //добавляем М в список подключенных Ж
                                        realVideoPartners[womanId] = realVideoPartners[womanId] ? realVideoPartners[womanId] : [];
                                        realVideoPartners[womanId].push(user_id);

                                        var _data = {};

                                        _data.reciver_id = user_id;
                                        _data.sender_id = womanId;
                                        _data.message = "";
                                        _data.reciver_sex = sex;
                                        _data.chat_type = 3;//видеочат

                                        logCommStart(_data);
                                        startTokensEatingTimer(user_id, womanId, 3);

                                        currentVideoSpeackerStatus[womanId][user_id].status = 2;
                                        currentVideoSpeackerStatus[user_id][womanId].status = 2;
                                        delete esstabConnecVideoPartners[womanId]._modifying;
                                        resolve();
                                        break;
                                    }
                                }
                                delete esstabConnecVideoPartners[womanId]._modifying;
                                resolve();
                            })
                        })
                    }
                });

                //универсальный обработчик для Ж и М
                socket.on('join-broadcast', function (user) {
                    console.log('join-broadcast');
                    //debugger;
                    var currentUser = user;

                    user.numberOfViewers = 0;

                    if (!listOfBroadcasts[user.broadcastid]) {
                        listOfBroadcasts[user.broadcastid] = {
                            broadcasters: {},
                            allusers: {},
                            typeOfStreams: user.typeOfStreams // object-booleans: audio, video, screen
                        };
                    }

                    var firstAvailableBroadcaster = getFirstAvailableBroadcater(user.broadcastid);
                    //debugger;
                    if (firstAvailableBroadcaster) {
                        listOfBroadcasts[user.broadcastid].broadcasters[firstAvailableBroadcaster.userid].numberOfViewers++;
                        socket.emit('join-broadcaster', firstAvailableBroadcaster, listOfBroadcasts[user.broadcastid].typeOfStreams, user.broadcastid);
                    } else {
                        currentUser.isInitiator = true;
                        var _data = {
                            'typeOfStreams': listOfBroadcasts[user.broadcastid].typeOfStreams,
                            'room': user_id
                        };
                        socket.emit('start-broadcasting', _data);
                    }

                    listOfBroadcasts[user.broadcastid].broadcasters[user.userid] = user;
                    listOfBroadcasts[user.broadcastid].allusers[user.userid] = user;
                });

                socket.on('message', function (message) {
                    socket.broadcast.emit('message', message);
                });

                //при изменении типа комуникации
                socket.on('partner type communication changing', function (data) {
                    //меняем данные о типе коммуникации в нашем главном объекте!
                    for (var k in possUsersObj[user_id].data) {
                        if (!possUsersObj[user_id].data.hasOwnProperty(k))
                            continue;
                        if (possUsersObj[user_id].data[k].user_id.toString() === data.id.toString()) {
                            possUsersObj[user_id].data[k].video = data.video;
                            break;
                        }
                    }


                    if (data.video) {//новый тип коммуникации - видео
                        //закрываем все ливчаты!
                        currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];
                        var index = currentSpeacker[user_id].indexOf(data.id.toString());
                        currentSpeacker[user_id].splice(index, 1);

                        //косяк
                        if (index > -1) {
                            io.sockets.in(data.id.toString()).emit('some chat partner finished chat', {'user_id': user_id});

                            var _data = {};
                            _data.user_closed_id = user_id;
                            _data.partner_to_out_id = data.id.toString();
                            _data.chat_type = '1';

                            logCommEnd(_data);

                            //stop eating tokens!
                            if (sex == '1')
                                stopTokensEatingTimer(user_id, data.id, '1');
                            else
                                stopTokensEatingTimer(data.id, user_id, '1');

                            currentSpeackerStatus [data.id][user_id].status = 3;
                            currentSpeackerStatus [user_id][data.id].status = 3;
                        }
                        //т.к. в currentSpeacker данные заносятся зеркально!

                        //зашита от багов ;(
                        currentSpeacker[data.id.toString()] = currentSpeacker[data.id.toString()] ? currentSpeacker[data.id.toString()] : [];
                        if (currentSpeacker[data.id.toString()])
                            index = currentSpeacker[data.id.toString()].indexOf(user_id);
                        else
                            index = -1;
                        currentSpeacker[data.id.toString()].splice(index, 1);
                    }
                    else {
                        //если был видео чат
                        //закрываем все видеочаты!
                        //защита от бага!
                        currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];
                        index = currnetVideoSpeakers[user_id].indexOf(data.id.toString());
                        currnetVideoSpeakers[user_id].splice(index, 1);
                        //ЕСЛИ ПРЕЖДЕ ЕЩЕ НИКТО НЕ ЗАКОНЧИЛ
                        if (index > -1) {
                            io.sockets.in(data.id.toString()).emit('some video chat partner finished video chat', {'user_id': user_id});

                            _data = {};
                            _data.user_closed_id = user_id;
                            _data.partner_to_out_id = data.id.toString();
                            _data.chat_type = '3';
                            logCommEnd(_data);

                            if (sex == '1')
                                stopTokensEatingTimer(user_id, data.id, '3');
                            else
                                stopTokensEatingTimer(data.id, user_id, '3');

                            currentVideoSpeackerStatus [data.id][user_id].status = 3;
                            currentVideoSpeackerStatus [user_id][data.id].status = 3;
                        }

                        currnetVideoSpeakers[data.id.toString()] = currnetVideoSpeakers[data.id.toString()] ? currnetVideoSpeakers[data.id.toString()] : [];
                        index = currnetVideoSpeakers[data.id.toString()].indexOf(user_id);
                        currnetVideoSpeakers[data.id.toString()].splice(index, 1);

                        if (sex === '2') {
                            //закрыла подруг
                            realVideoPartners[user_id] = realVideoPartners[user_id] ? realVideoPartners[user_id] : [];
                            index = realVideoPartners[user_id].indexOf(data.id.toString());
                            if (index >= 0)
                                realVideoPartners[user_id].splice(index, 1);
                            if (realVideoPartners[user_id].length == 0) {
                                womenCamStreaming[user_id] = false;//стрима сейчас нет!
                                console.log('close stream 2 2 2');
                                io.sockets.in(user_id).emit('close stream');//чисто для девушек
                            }

                            if (listOfBroadcasts[user_id]) {
                                listOfBroadcasts[user_id].broadcasters = {};//обновляем список
                                listOfBroadcasts[user_id].allusers = {};
                            }//обновляем список
                        }
                        else {
                            //закрыл мужик
                            for (var i in realVideoPartners)
                                for (var j in realVideoPartners[i]) {
                                    if (!realVideoPartners[i].hasOwnProperty(j))
                                        continue;
                                    if (i.toString() === data.id.toString() && realVideoPartners[i][j] == user_id) {
                                        index = realVideoPartners[i].indexOf(user_id);
                                        realVideoPartners[i].splice(index, 1);//убераем пользователя
                                        if (realVideoPartners[i].length == 0) {
                                            io.sockets.in(i.toString()).emit('close stream');//чисто для девушек
                                            womenCamStreaming[i] = false;//ТАК КАК НИКТО НЕ МОНИТОРИТ ПОДРУГУ - ВІРУБАЕМ ЕЕ
                                            if (listOfBroadcasts[i]) {
                                                listOfBroadcasts[i].broadcasters = {};//обновляем список
                                                listOfBroadcasts[i].allusers = {};
                                            }
                                            console.log(listOfBroadcasts)
                                        }
                                        break;
                                    }
                                }
                        }
                    }
                });

                socket.on('changed user in chat window', function (data) {
                    setPartnerId[user_id] = data.user_id.toString();
                });

                socket.on('set user in chat window', function (data) {
                    setPartnerId[user_id] = data.user_id.toString();
                    setTimeout(function () {
                        io.sockets.in(user_id).emit('set user', {'user_id': setPartnerId[user_id]});
                    }, 1000);

                });

                socket.on('disconnect', function () {
                    //какокод
                    if (referer.match(/chat_demo/gi)) {
                        /*uncomment if necessary*/
                        //possUsersObj[user_id]={};
                        chatWindows[user_id] = chatWindows[user_id] || {};
                        if (chatWindows[user_id]._modifying) {
                            chatWindows[user_id]._modifying.then(function () {
                                chatWindows[user_id]._modifying = new Promise(function (resolve, reject) {
                                    --chatWindows[user_id].amount;
                                    if (chatWindows[user_id] && chatWindows[user_id].amount < 0) {
                                        console.log('BAD PROMISES! chatServerHtpps p 1724');
                                        chatWindows[user_id].amount = 0;
                                    }
                                    try {
                                        if (chatWindows[user_id] && chatWindows[user_id].amount == 0/*||(data&&data.force_closing)*/) {
                                            closeUserRelativeConnection(user_id, sex);
                                        }
                                    }
                                    catch (e) {
                                        console.log('positoon 1573');
                                        console.log(e);
                                        delete chatWindows[user_id]._modifying;
                                        resolve()
                                    }
                                    delete chatWindows[user_id]._modifying;
                                    resolve()
                                })
                            })
                        }
                        else {
                            chatWindows[user_id]._modifying = new Promise(function (resolve, reject) {
                                --chatWindows[user_id].amount;
                                if (chatWindows[user_id] && chatWindows[user_id].amount < 0) {
                                    console.log('BAD PROMISES! chatServerHtpps p 1724');
                                    chatWindows[user_id].amount = 0;
                                }
                                try {
                                    if (chatWindows[user_id].amount == 0/*||(data&&data.force_closing)*/) {
                                        closeUserRelativeConnection(user_id, sex);
                                    }
                                }
                                catch (e) {
                                    console.log('position 1599');
                                    console.log(e);
                                    delete chatWindows[user_id]._modifying;
                                    resolve()
                                }
                                delete chatWindows[user_id]._modifying;
                                resolve()
                            })
                        }

                    }
                    //browser window
                    else {
                        var uid;
                        try {
                            uid = socket.handshake.session.passport.user.user_id;
                        }
                        catch (e) {
                            console.log(e);
                            console.log('position p1612 chatServerHTTPS')
                        }

                        if (browserWindow && browserWindow[uid] && browserWindow[uid]._modifying) {
                            browserWindow[uid]._modifying = new Promise(function (resolve) {
                                --browserWindow[uid].amount;

                                if (browserWindow[uid] && browserWindow[uid].amount < 0) {
                                    browserWindow[uid].amount = 0;

                                }
                                if (browserWindow[uid] && browserWindow[uid].amount == 0) {
                                    for (var i in possUsersObj) {
                                        for (var j in possUsersObj[i].data) {
                                            var user_id = possUsersObj[i].data[j].user_id.toString();

                                            if (user_id === uid.toString()) {
                                                io.sockets.in(i).emit('some possible partner is already not online', {'uid': uid.toString()});
                                                //TODO update possUsersObj!
                                            }
                                        }
                                    }
                                }
                                delete browserWindow[uid]._modifying;
                                resolve();
                            })
                        }
                    }

                });

                socket.on('stop chatting', function (data) {
                    var partner_id = data.user_id.toString();
                    currentSpeacker[user_id] = currentSpeacker[user_id] ? currentSpeacker[user_id] : [];
                    var index = currentSpeacker[user_id].indexOf(partner_id);
                    currentSpeacker[user_id].splice(index, 1);

                    //косяк
                    if (index > -1) {
                        io.sockets.in(partner_id).emit('some chat partner finished chat', {'user_id': user_id});
                        var _data = {};
                        _data.user_closed_id = user_id;
                        _data.partner_to_out_id = partner_id;
                        _data.chat_type = '1';

                        logCommEnd(_data);

                        //stop eating tokens!
                        if (sex == '1')
                            stopTokensEatingTimer(user_id, data.id, '1');
                        else
                            stopTokensEatingTimer(data.id, user_id, '1');

                        currentSpeackerStatus [data.id][user_id].status = 3;
                        currentSpeackerStatus [user_id][data.id].status = 3;
                    }
                    console.log('some chat partner finished chat')
                    //т.к. в currentSpeacker данные заносятся зеркально!
                    currentSpeacker[partner_id] = currentSpeacker[partner_id] ? currentSpeacker[partner_id] : [];
                    if (currentSpeacker[partner_id])
                        index = currentSpeacker[partner_id].indexOf(user_id);
                    else
                        index = -1;
                    currentSpeacker[partner_id].splice(index, 1);
                    currnetVideoSpeakers[user_id] = currnetVideoSpeakers[user_id] ? currnetVideoSpeakers[user_id] : [];
                    index = currnetVideoSpeakers[user_id].indexOf(partner_id);
                    currnetVideoSpeakers[user_id].splice(index, 1);
                    //ЕСЛИ ПРЕЖДЕ ЕЩЕ НИКТО НЕ ЗАКОНЧИЛ
                    if (index > -1) {
                        io.sockets.in(partner_id).emit('some video chat partner finished video chat', {'user_id': user_id});

                        _data = {};
                        _data.user_closed_id = user_id;
                        _data.partner_to_out_id = partner_id;
                        _data.chat_type = '3';
                        logCommEnd(_data);

                        if (sex == '1')
                            stopTokensEatingTimer(user_id, data.id, '3');
                        else
                            stopTokensEatingTimer(data.id, user_id, '3');

                        currentVideoSpeackerStatus [data.id][user_id].status = 3;
                        currentVideoSpeackerStatus [user_id][data.id].status = 3;
                    }

                    //т.к. в currnetVideoSpeakers данные заносятся зеркально!
                    currnetVideoSpeakers[partner_id] = currnetVideoSpeakers[partner_id] ? currnetVideoSpeakers[partner_id] : [];
                    index = currnetVideoSpeakers[data.id.toString()].indexOf(user_id);
                    currnetVideoSpeakers[partner_id].splice(index, 1);

                    if (sex === '2') {
                        //закрыла подруг
                        realVideoPartners[user_id] = realVideoPartners[user_id] ? realVideoPartners[user_id] : [];
                        index = realVideoPartners[user_id].indexOf(partner_id);
                        if (index >= 0)
                            realVideoPartners[user_id].splice(index, 1);

                        if (realVideoPartners[user_id].length == 0) {
                            womenCamStreaming[user_id] = false;//стрима сейчас нет!
                            //realVideoPartners[user_id]=[];
                            io.sockets.in(user_id).emit('close stream');//чисто для девушек
                        }

                        //if (!currentUser) return;
                        if (listOfBroadcasts[user_id]) {
                            listOfBroadcasts[user_id].broadcasters = {};//обновляем список
                            listOfBroadcasts[user_id].allusers = {};
                        }//обновляем список
                    }
                    else {
                        //закрыл мужик
                        for (var i in realVideoPartners)
                            for (var j in realVideoPartners[i]) {
                                if (!realVideoPartners[i].hasOwnProperty(j))
                                    continue;
                                if (realVideoPartners[i][j].toString() === user_id) {
                                    index = realVideoPartners[i].indexOf(user_id);
                                    realVideoPartners[i].splice(index, 1);//убераем пользователя
                                    //TODO на последнего пользователя
                                    if (realVideoPartners[i].length == 0) {
                                        io.sockets.in(i.toString()).emit('close stream');//чисто для девушек
                                        womenCamStreaming[i] = false;//ТАК КАК НИКТО НЕ МОНИТОРИТ ПОДРУГУ - ВІРУБАЕМ ЕЕ
                                        if (listOfBroadcasts[i]) {
                                            listOfBroadcasts[i].broadcasters = {};//обновляем список
                                            listOfBroadcasts[i].allusers = {};
                                        }
                                    }
                                }
                            }
                    }

                });

                //запит історії витрат користувача за вказаний період
                socket.on('get purchase story', function (data) {
                    var isTable = data.isTable;

                    tokensFlowData[user_id] = tokensFlowData[user_id] ? tokensFlowData[user_id] : {};
                    /*-------NEW VERSION---------*/
                    tokensFlowData[user_id].actual = new Promise(function (resolve, reject) {

                        getTokensFlowData(user_id, data, resolve, reject)
                    });

                    if (tokensFlowData[user_id].actual) {
                        tokensFlowData[user_id].actual.then(function () {

                            if (isTable)
                                socket.emit('purchase story data for table', tokensFlowData[user_id].data);
                            else
                                socket.emit('purchase story data', tokensFlowData[user_id].data);
                        })
                    }
                    else {
                        if (isTable)
                            socket.emit('purchase story data for table', tokensFlowData[user_id].data);
                        else
                            socket.emit('purchase story data', tokensFlowData[user_id].data);
                    }
                });

                socket.on('error', function (err) {
                    console.log('error in socket chatServerHTTPS.js  p 1477');
                    console.log(err);
                    throw err;
                });


                socket.on('get smiles config', function () {
                    //TODO здесь не предусмотренно разделение смайликов по сайтам!
                    var content = fs.readFileSync(app.dir + '/config/helena/smilesConfig.json', "utf8")
                    socket.emit('smiles config', content);
                });

                //актуализирует данные о токенах пользователя на проьтяжении заданного периода времени;
                function getTokensFlowData(user_id, periodObj, resolve/*,reject*/) {

                    var isTable = periodObj.isTable;
                    var begin = periodObj.begin;//string
                    var end = periodObj.end;//string
                    var _q;

                    //проверка на нужный запрос
                    if (!isTable)
                        _q = "select json_agg(row_to_json(q.*)) from (select * from user_tokens_flow_short_view  where user_id='" + user_id + "' and date>='" + begin + "' and date<='" + end + "')q"
                    else {
                        _q = "select json_agg(row_to_json(q.*)) \
						from (select user_id::text,date_part('epoch',date)*1000 as date ,coalesce(value,0) as tokens,description,payment_system,currency,coalesce(money,0) as money,status \
						from public.user_payment where user_id='" + user_id + "' and date>='" + begin + "' and date<='" + end + "' order by date)q";
                    }

                    console.log(_q);

                    client.query(_q, function (err) {
                        if (err) {
                            delete tokensFlowData[user_id].actual;
                            resolve();
                        }
                    })
                        .on('row', function (row) {
                            console.log('get actual data');
                            tokensFlowData[user_id].data = row.json_agg;
                        })
                        .on('end', function () {
                            delete tokensFlowData[user_id].actual;
                            resolve();
                        });
                }

                //чтобы реализовать множественный видеочат, который не будет работать максимально продуктивно, нужно переделать эту функцию(например раскомментировать строку)

                function getFirstAvailableBroadcater(broadcastid) {
                    var broadcasters = listOfBroadcasts[broadcastid].broadcasters;
                    var firstResult;
                    for (var userid in broadcasters) {
                        if (!broadcasters.hasOwnProperty(userid))
                            continue;
                        if (broadcasters[userid].isInitiator) {//всегда возвращаем инициатора!
                            firstResult = broadcasters[userid];
                        } else delete listOfBroadcasts[broadcastid].broadcasters[userid];
                    }
                    return firstResult;
                }
            });

            //обработка сокетов
            io.on('listening', function () {
                console.log('Chat server listening at ' + server.address().address + ':' + server.address().port);
            });

            io.on('close', function () {
                console.log('Chat server is now closed');
            });

            io.on('error', function (err) {
                console.log('error:', err);
            });
        })
    }
    //запускаем сервер
    server.listen(PORT, serverListenHandler);
    serverHttp.listen(HTTPORT, serverListenHandler)
    /*----------EXTRA ROUTES!----------------*/
    app.post('/helena/get_extra_message_story', function (req, res) {
        if (!req.session)
            return;
        var user_id = req.session.passport.user.user_id;
        var data = req.body;
        getExtraMessageStory(user_id, data, req, res);
    });

    function getChatRate() {
        var _q = 'select row_to_json(q) from (select * from public.finance_service_type)q';
        var query = client.query(_q);

        query.on('row', (row) => {
            fullRateType = row;
            for (var i in row) {
                if (!row.hasOwnProperty(i))
                    continue;
                rateChatType[row[i].service_type] = row[i].price_per_unit;
            }

        })
            .on('error', (err) => {
                console.log(err)
            })
    }
};

function closeUserRelativeConnection(user_id, sex) {
    //TODO fix bag with double sending message about finish!
    sex = sex ? sex : 1;

    for (var i in currentSpeacker[user_id]) {
        //console.log(currentSpeacker)
        var key = currentSpeacker[user_id][i].toString();

        for (var j = 0; j < currentSpeacker[key].length; j++) {
            if (currentSpeacker[key][j] === user_id.toString()) {
                currentSpeacker[key].splice(j, 1);
                var _data = {};
                _data.user_closed_id = user_id;

                io.sockets.in(key).emit('some chat partner finished chat', {'user_id': user_id.toString()});

                _data = {};
                _data.user_closed_id = user_id;
                _data.partner_to_out_id = key;
                _data.chat_type = '1';
                logCommEnd(_data);

                if (sex == '1')
                    stopTokensEatingTimer(user_id, key, '1');
                else
                    stopTokensEatingTimer(key, user_id, '1');

                currentSpeackerStatus [key][user_id].status = 3;
                currentSpeackerStatus [user_id][key].status = 3;
                break;
            }
        }
    }
    //удаляем себя!
    currentSpeacker[user_id] = [];

    //делаемо тоже самое с видео чатом!
    for (i in currnetVideoSpeakers[user_id]) {
        key = currnetVideoSpeakers[user_id][i].toString();
        for (j = 0; j < currnetVideoSpeakers[key].length; j++) {
            if (currnetVideoSpeakers[key][j] === user_id.toString()) {
                currnetVideoSpeakers[key].splice(j, 1);
                _data = {};
                _data.user_closed_id = user_id;

                io.sockets.in(key).emit('some video chat partner finished video chat', {'user_id': user_id.toString()});

                _data = {};
                _data.user_closed_id = user_id;
                _data.partner_to_out_id = key;
                _data.chat_type = '3';
                logCommEnd(_data);
                if (sex == '1')
                    stopTokensEatingTimer(user_id, key, '3');
                else
                    stopTokensEatingTimer(key, user_id, '3');

                currentVideoSpeackerStatus [key][user_id].status = 3;
                currentVideoSpeackerStatus [user_id][key].status = 3;
                break;
            }
        }
    }
    //удаляем себя!
    currnetVideoSpeakers[user_id] = [];
    //================================ВИДЕОЧАТ!
    //TODO ошибка - дубликация логики!
    //УДАЛЯЕМ ЕСЛИ ЕСТЬ ЧТО УДАЛЯТЬ ИЗ ВИДЕО-ЧАТ СОБЕСЕДНИКОВ

    if (sex === '2') {
        womenCamStreaming[user_id] = false;//стрима сейчас нет!
        for (i in realVideoPartners[user_id]) {
            if (!realVideoPartners[user_id].hasOwnProperty(i))
                continue;
            key = realVideoPartners[user_id][i].toString();
            //io.sockets.in(key).emit('some video chat partner finished video chat',{'user_id':user_id.toString()});
            _data = {};
            _data.user_closed_id = user_id;
            _data.partner_to_out_id = key;
            _data.chat_type = '3';
            logCommEnd(_data);

            if (sex == '1')
                stopTokensEatingTimer(user_id, key, '3');
            else
                stopTokensEatingTimer(key, user_id, '3');

            currentVideoSpeackerStatus [key][user_id].status = 3;
            currentVideoSpeackerStatus [user_id][key].status = 3;
        }
        realVideoPartners[user_id] = [];
        //if (!currentUser) return;
        if (listOfBroadcasts[user_id]) {
            listOfBroadcasts[user_id].broadcasters = {};//обновляем список
            listOfBroadcasts[user_id].allusers = {};
        }//обновляем список
    }
    else {
        for (i in realVideoPartners)
            for (j in realVideoPartners[i]) {
                if (!realVideoPartners[i].hasOwnProperty(j))
                    continue;
                if (realVideoPartners[i][j].toString() === user_id) {

                    realVideoPartners[i].splice(j, 1);//убераем пользователя

                    if (realVideoPartners[i].length == 0) {
                        io.sockets.in(i.toString()).emit('close stream');//чисто для девушек
                        womenCamStreaming[i] = false;//ТАК КАК НИКТО НЕ МОНИТОРИТ ПОДРУГУ - ставим флаг
                        if (listOfBroadcasts[i]) {
                            listOfBroadcasts[i].broadcasters = {};//обновляем список
                            listOfBroadcasts[i].allusers = {};
                        }
                    }
                }
            }
    }
}

//отправляем актуальных партнеров кому-тоы
function sendActualChatPartners(user_id, currentSpeaker) {

    //данные актуальны после запуска сервера
    //при вызове функции addToChat sendActualChatPartners вызывается по ее завершению
    //console.log(possUsersOіbj);
    //promise realised
    possUsersObj[user_id] = possUsersObj[user_id] ? possUsersObj[user_id] : {};

    if (!possUsersObj[user_id] || !possUsersObj[user_id].actual) {
        //io.sockets.in(user_id).emit('set user',{'user_id':(setPartnerId[user_id]||0)});

        for (var i in possUsersObj[user_id].data) {
            if (!possUsersObj[user_id].data.hasOwnProperty(i))
                continue;
            var uid = possUsersObj[user_id].data[i].user_id;
            //добавляем онлайн статус
            usersOnline[uid] = usersOnline[uid] ? usersOnline[uid] : false;
            possUsersObj[user_id].data[i].online = usersOnline[uid];
        }

        if (chatWindows[user_id]._modifying) {
            chatWindows[user_id]._modifying.then(() => {

                io.sockets.in(user_id).emit('actual partners for chat window', {
                    'user_list': possUsersObj[user_id].data,
                    'chatMessages': chatPairsMessages[user_id],
                    'videoChatMessages': videoChatPairsMessages[user_id],
                    'currentSpeaker': currentSpeaker
                });
            })
        }
        else {
            io.sockets.in(user_id).emit('actual partners for chat window', {
                'user_list': possUsersObj[user_id].data,
                'chatMessages': chatPairsMessages[user_id],
                'videoChatMessages': videoChatPairsMessages[user_id],
                'currentSpeaker': currentSpeaker
            });
        }
    }
    else {
        possUsersObj[user_id].actual.then(function () {
            io.sockets.in(user_id).emit('set user', {'user_id': setPartnerId[user_id]});

            for (var i in possUsersObj[user_id].data) {
                if (!possUsersObj[user_id].data.hasOwnProperty(i))
                    continue;
                var uid = possUsersObj[user_id].data[i].user_id;
                //добавляем онлайн статус
                usersOnline[uid] = usersOnline[uid] ? usersOnline[uid] : false;
                possUsersObj[user_id].data[i].online = usersOnline[uid];
            }
            //если видео чат в сообщения отсылать совсем другое!
            //console.log(JSON.stringify(possUsersObj[user_id].data))
            io.sockets.in(user_id).emit('actual partners for chat window', {
                'user_list': possUsersObj[user_id].data,
                'chatMessages': chatPairsMessages[user_id],
                'videoChatMessages': videoChatPairsMessages[user_id],
                'currentSpeaker': currentSpeaker
            });
        })
    }
}

//при добавлении кого-то в чат	делаем данные актуальными и обновляем чатокна
//палит прежде чем чат окно открывается - ошибка
function makeDataActual(data, user_id, isVideo) {
    var user_to_set = data.user_id;
    possUsersObj[user_id] = possUsersObj[user_id] ? possUsersObj[user_id] : {};
    if (!Array.isArray(possUsersObj[user_id].data))
        possUsersObj[user_id].data = [];

    //проверка на существование партнера в массиве!
    for (var i in possUsersObj[user_id].data)
        if (possUsersObj[user_id].data.hasOwnProperty(i)
            &&
            possUsersObj[user_id].data[i].user_id == user_to_set)

            if (possUsersObj[user_id].data[i].video.toString() === isVideo.toString()) {//если совпадают флаги
                return sendActualChatPartners(user_id, user_to_set)
            }
            else {
                //сообщения апдейтить не надо так что - ретурн
                possUsersObj[user_id].data[i].video = isVideo;
                return sendActualChatPartners(user_id, user_to_set)
            }

    //we have to add partner
    addPossiblePartner(user_id, user_to_set);

    possUsersObj[user_id].actual = new Promise(function (resolve) {
        let query = "select row_to_json(q) from  (select user_id::text, * from user_view where user_id='" + user_to_set + "' limit 1)q";
        client.query(query, function (err) {
            if (err) {
                console.error('error running this query permChat 292p', err);
                // client.end();
                delete possUsersObj[user_id].actual;
                resolve()
            }
        })
            .on('row', function (row) {
                let result = row;
                //добавляем конкретного пользователя в список пользователей
                result.row_to_json.video = isVideo;//"+isVideo+" as video

                possUsersObj[user_id] = possUsersObj[user_id] ? possUsersObj[user_id] : {};
                possUsersObj[user_id].data = possUsersObj[user_id].data ? possUsersObj[user_id].data : [];

                possUsersObj[user_id].data.push(result.row_to_json);
            })
            .on('end', function () {
                //вытягиваем сообщения
                //данные актуальными становятся в функции getMessageStory
                getMessageStory(user_to_set, user_id, resolve);
                //sendActualChatPartners(user_id);
                //resolve();
            })
    })
}

//логер сообщений
function logMessageSendAction(user_id, to_user_id, message, type, spamming, is_first) {
    var _is_first = typeof(is_first) != 'undefined' ? is_first : false;
    var _q = "INSERT INTO user_chat_log(user_id,to_user_id,message,type,spamming,is_first) VALUES('" + user_id
        + "','" + to_user_id + "','" + message + "','" + type + "','" + spamming + "','" + _is_first + "')";
    client.query(_q, function (err, result) {
        if (err) {
            console.log(_q);
            console.error('error running this query permChat 131p', err);
        }
    });
}

//chat invitation
function logCommTry(user_id, partner_id, message, chat_type, cb) {
    let q = "INSERT INTO public.user_chat_call (from_user,to_user,message,chat_status,chat_type) " +
        "values('" + user_id + "','" + partner_id + "','" + message + "','4','" + chat_type + "') returning user_chat_call_id::text";

    console.log(q);

    client.query(q, (err) => {
        if (err) {
            console.log('Error in chatServerHTTPS p2094');
            console.log(err);
            return;
        }
    })
        .on('row', (data) => {
            //callback
            cb(data.user_chat_call_id);
        });
}
//начало чата видеочата
function logCommStart(data) {
    var reciver_id = data.reciver_id,
        sender_id = data.sender_id,
        reciver_sex = data.reciver_sex,
        message = data.message,
        chat_type = data.chat_type;

    var sender_sex = reciver_sex === 1 ? 2 : 1;

    //TODO make it UPDATE QUERY!
    var _q = "INSERT INTO public.user_chat_call(\
            from_user, to_user, message, view_flag,  \
            chat_type, sex_sender,chat_status,end_date)\
    VALUES ('" + sender_id + "', '" + reciver_id + "', '" + message + "', true, '" + chat_type + "', \
			'" + sender_sex + "','2',null);";

    console.log(_q);

    client.query(_q, function (err) {
        if (err) {
            console.log('Error during query p613 permChatServerHttps');
            console.log(err);
        }
    });
}

function logCommEnd(data) {
    var user_out_id = data.user_closed_id;
    var partner_to_out_id = data.partner_to_out_id;
    var chat_type = data.chat_type;

    var _q = "UPDATE public.user_chat_call\
		   SET end_date=now(),chat_status='3'\
		   WHERE ((from_user='" + partner_to_out_id + "' and to_user='" + user_out_id + "')  or (to_user='" + partner_to_out_id + "' and from_user='" + user_out_id + "')) and chat_type='" + chat_type + "' and chat_status='2';"
    console.log(_q);

    client.query(_q, function (err) {
        if (err) {
            console.log('Error during query p675 permChatServerHttps');
            console.log(err);
        }
    });
}

function stopTokensEatingTimer(man_id, woman_id, type) {
    if (chargesIntervals[man_id.toString()] && chargesIntervals[man_id.toString()][woman_id.toString()] && chargesIntervals[man_id.toString()][woman_id.toString()][type.toString()])
        clearInterval(chargesIntervals[man_id.toString()][woman_id.toString()][type.toString()]);
}

function tokensIsOver(man_id) {
    for (var i in chargesIntervals[man_id]) {
        if (!chargesIntervals[man_id].hasOwnProperty(i))
            continue;
        for (var j in chargesIntervals[man_id][i]) {
            if (!chargesIntervals[man_id][i].hasOwnProperty(j))
                continue;
            clearInterval(chargesIntervals[man_id][i][j]);
        }
    }
}

function startTokensEatingTimer(user_id, woman_id, type) {
    user_id = user_id.toString();
    woman_id = woman_id.toString();
    type = type.toString();

    chargesIntervals[user_id] = chargesIntervals[user_id] ? chargesIntervals[user_id] : {};
    chargesIntervals[user_id][woman_id] = chargesIntervals[user_id][woman_id] ? chargesIntervals[user_id][woman_id] : {};
    //хаваем сразу за след 10 сек, чтоб не уйти в минус
    eatTokens(user_id, woman_id, type);

    chargesIntervals[user_id][woman_id][type] = setInterval(function () {
        eatTokens(user_id, woman_id, type);
    }, TOKENS_EAT_PERIOD)
}

function eatTokens(man_id, woman_id, type) {
    if (user_tokens[man_id] < rateChatType[type]) {
        io.sockets.in(man_id).emit('close socket because of tokens absence');
        //io.sockets.in(user_id).emit('recharge your account');
        tokensIsOver(man_id);
        return
    }

    var _q = "INSERT INTO public.user_credit(\
					men_id, women_id, credit, credit_type, service_type,count)\
			VALUES ('" + man_id + "','" + woman_id + "','" + rateChatType[type.toString()] + "','2','" + type + "','" + rateChatType[type.toString()] + "')";
    console.log(_q);
    client.query(_q, function (err, result) {
        if (err) {
            console.log('error during query p331');
            console.log(err);
        }
    })
        .on('end', function () {
            //client.end()
        })
}

function getUsersAvatars() {
    console.log('getUsersAvatars function');
    let _q = "select json_agg(row_to_json(q.*)) from (select * from user_avatar_short_view)q";
    console.log(_q);
    client.query(_q, function (err, row) {
        if (err) {
            userAvatars = {};
            return;
        }
    })
        .on('row', function (row) {
            userAvatars = row.json_agg;
        })
        .on('end', function () {
            //
        })

}

function getSimpleUserAvatar(user_id) {
    for (var i in userAvatars) {
        if (userAvatars[i].user_id == user_id)
            return userAvatars[i];
    }
    return {};
}

function logSpamMessage(ids_buffer, user_id, message, isVideo) {
    ids_buffer = '{"users":[' + ids_buffer.join(',') + ']}';

    let q = "INSERT INTO user_chat_log(user_id,message,type,extra_key) values('" + user_id + "','" + message + "','" + (isVideo ? 1 : 2) + "','" + ids_buffer + "')";
    client.query(q, (err) => {
        if (err) {
            console.log('Error chatserverHTTPS p2254');
            console.log(err);
        }
    });
}
//вытягивает все сообщения по укзаному типу между двумя собеседниками
function getMessageStory(whom, user_id, resolve, limit) {//кто кому
    var _q =
        "select json_agg(row_to_json(q)) as mess_arr from(\
        select type,json_agg(row_to_json(q.*)) as messages from (\
            select * from (\
                select * from (\
                    select  type::text,\
                            firstname,\
                            message,\
                            date_part('epoch',cdate)*1000 as create_date\
                    from user_chat_log_view\
                    where (from_user_id='" + whom + "' and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + whom + "')\
                    order by user_chat_log_view.cdate desc limit " + (limit ? limit : 25) + "\
                )q1\
            )q order by create_date\
        )q group by type\
    )q";

    client.query(_q, function (err, result) {
        if (err) {
            console.error('error running this query permChat 328', err);
            console.log(_q);
            resolve();
        }
    })
        .on('row', function (row) {
            //получаем только 1 строку результата
            //получили масиив сообщений всех типов!!!! ЭТОТ МАССИВ СОДЕРЖИТ ВСЕ АКТУАЛЬНЫЕ СООБЩЕНИЯ!!!
            for (var i in row.mess_arr)
                if (row.mess_arr[i].type === '1') {
                    chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
                    chatPairsMessages[user_id][whom] = chatPairsMessages[user_id][whom] ? chatPairsMessages[user_id][whom] : [];
                    chatPairsMessages[user_id][whom] = row.mess_arr[i].messages ? row.mess_arr[i].messages : [];//кому кто

                }
                else if (row.mess_arr[i].type === '2') {
                    videoChatPairsMessages[user_id] = videoChatPairsMessages[user_id] ? videoChatPairsMessages[user_id] : {};
                    videoChatPairsMessages[user_id][whom] = videoChatPairsMessages[user_id][whom] ? videoChatPairsMessages[user_id][whom] : [];
                    videoChatPairsMessages[user_id][whom] = row.mess_arr[i].messages ? row.mess_arr[i].messages : [];//кому кто
                }
            //could be just caching messages on start!
            if (resolve) {
                sendActualChatPartners(user_id, whom);
                resolve();
            }

        })
        .on('end', function () {
            //проверка на отстутствие сообщений
            chatPairsMessages[user_id] = chatPairsMessages[user_id] ? chatPairsMessages[user_id] : {};
            videoChatPairsMessages[user_id] = videoChatPairsMessages[user_id] ? videoChatPairsMessages[user_id] : {};

        })
}

function getExtraMessageStory(user_id, data, req, res) {
    app.getDB(req, res, function (db, req) {
        let limit = data.limit;
        let offset = data.offset;
        let whom = data.whom_id;
        let type = data.type;
        var _q = [
            {
                "id": "data", "query": "select json_agg(row_to_json(q)) as mess_arr from(\
                select * from (\
                    select * from (\
                        select  type,\
                                firstname,\
                                message,\
                                date_part('epoch',cdate)*1000 as create_date\
                        from user_chat_log_view\
                        where type='" + type + "' and (from_user_id='" + whom + "' and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + whom + "')\
                    order by user_chat_log_view.cdate desc limit " + (limit ? limit : 25) + " offset " + (offset ? offset : 0) + "\
                    )q1\
                )q order by create_date\
            )q"
            },
            {
                "id": "count", "query": "select  count(*)\
                        from user_chat_log_view\
                        where type='" + type + "' and (from_user_id='" + whom + "' and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + whom + "')"
            }
        ];
        console.log(_q);

        app.pg_request({
            'conString': db.conString,
            'res': res,
            'req': req,
            'app': app
        }, _q, function (err, result, res) {
            if (err) {
                res.status = 500;
                res.json({'result': 'error', 'description': err});
                return;
            }
            res.send({'data': result.data.mess_arr, 'count': result.count.count, 'whom': whom});
        });
    });
}


function getAllPossiblePartners(resolve) {
    var _q = "select json_agg(row_to_json(q.*)) as result\
            from (\
                select user_id,p.partners from (select user_id,array_agg(partner_id) as partners\
            from user_chat_partners\
            where not is_ignored group by user_id )q1\
                ,lateral (select json_agg(row_to_json(q)) as partners from  \
                (select false as video, user_id::text,* from user_profile where user_id= any (q1.partners))q)p\
        )q";

    client.query(_q, (err) => {
        if (err) {
            console.log('Error chatServer error p 2385');
            console.log(err);
            //just empty poss partners list
            resolve();
        }
    })
        .on('end', () => {
            console.log('successfuly loaded posiible partners');
        })
        .on('row', (data) => {
            var row = data.result;
            console.log({row});
            for (var i in row) {
                let user_id = row[i].user_id;
                possUsersObj[user_id] = {};
                possUsersObj[user_id].data = row[i].partners;
                for (var j in row[i].partners) {
                    getMessageStory(row[i].partners[j].user_id, user_id);
                }
            }
            resolve();
        })
}

/*adding posiible user to DB*/
function addPossiblePartner(user_id, partner_id) {
    console.log('addPossiblePartner function');
    let _q = "INSERT into public.user_chat_partners( user_id, partner_id) values ('" + user_id + "','" + partner_id + "')";

    client.query(_q, (err) => {
        if (err) {
            console.log('Error chatServer p 2383');
            console.log(err);
        }
    });
}

/*remove posiible user to DB*/
function removePosiblePartner(user_id, partner_id) {
    console.log('removePosiblePartner function');
    let _q = "delete from public.user_chat_partners where user_id='" + user_id + "' and  partner_id='" + partner_id + "'";

    client.query(_q, (err) => {
        if (err) {
            console.log('Error chatServer p 2388');
            console.log(err);
        }
    });
}
/*add to ignore posiible user to DB*/
function blockPosiiblePartner(user_id, partner_id) {
    //TODO implement
    console.log('blockPosiiblePartner function');
    let _q = "update public.user_chat_partners set is_ignored=true where user_id='" + user_id + "' and  partner_id='" + partner_id + "'";

    client.query(_q, (err) => {
        if (err) {
            console.log('Error chatServer p 2388');
            console.log(err);
        }
    });
}