var conString;
var pg = require('pg');
var userPhotosObject = {};//[user_id]
var userVideosObject = {};
var smilesConf;
var fs = require('fs')
var io;
var client;//global client

var cookieParser = require('cookie-parser')();
var session = require('cookie-session')({secret: 'securedsession'});
var tls = require('tls')
var mkdirp = require('mkdirp')
var _ = require('underscore');

//shared object of user tokens
var user_tokens;
var rateChatType = {};
var paidFiles = {};//videos and photos paid by men


module.exports = function (share_obj) {
    console.log("--------------------------------date------------------------------")
    app = share_obj;
    user_tokens = share_obj.user_tokens;

    //app.use(session);
    var configMail = require(app.dir + '/config/helena/mailConfig.json');
    var PORT = configMail.port;//порт сервера
    // server = require('https').createServer(app.secureOptions, app)

    var fileConfg = require(app.dir + '/config/helena/filesServer.json');
    conString = 'pg://' + fileConfg.dataBase.admin + ':' + fileConfg.dataBase.pass + '@' + fileConfg.dataBase.host + ':' + fileConfg.dataBase.port + '/' + fileConfg.dataBase.dbname;
    console.log('\n\n\n\n\n ' + conString)
    client = new pg.Client(conString);

    client.connect((err) => {
        console.log(err);
        getChatRate();
        getPaidFiles();//videos and photos paid by men
    })

    io = require('socket.io');//запускаем сервер
    app.portInUse(PORT, function(used) {
        console.log({used});
        io = io.listen(PORT, function () {
            console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++')

            console.log('helena main server listening at ' + PORT);
        });//server,{});
    io.set("transports", ["xhr-polling", "polling", 'websocket']);

    //шарим сокетам данные пасспорта
    io.use(function (socket, next) {
        var req = socket.handshake;
        var res = {};
        cookieParser(req, res, function (err) {
            if (err) return next(err);
            session(req, res, next);
        });
    });


    //обработка сокетов
    io.on('listening', function () {
        console.log('helena server listening at ' + server.address().address + ':' + server.address().port);
    });

    io.on('close', function () {
        console.log('Chat server is now closed');
    });

    io.on('error', function (err) {
        console.log('error:', err);
    });

    io.sockets.on('connection', function (socket) {
        try {
            var user_id = socket.handshake.session.passport.user.user_id;
            socket.join(user_id)
        }
        catch (e) {

            console.log('Probably someone loaded login page!');
            return
        }
    })

    })

    app.get('/helena/get_sex', function (req, res) {
        var user_sex = req.session.passport.user.sex;

        var data = {};
        data.sex = user_sex;
        res.send({'sex': user_sex});
    })
    app.get('/helena/test_user', function (req, res) {
        //var user_sex=req.session.passport.user.sex;

        res.json(req.session.passport);
    })

    app.post('/helena/smiles', function (req, res) {
        var content = fs.readFileSync(app.dir + '/config/helena/smilesConfig.json', "utf8")
        res.send(content);
    })

    app.post('/helena/multimedia/payable', function (req, res) {
        var id = req.body.photo_id;

        var type = req.body.type;
        var user_id = req.session.passport.user.user_id;
        var user_sex = req.session.passport.user.sex;

        app.getDB(req, res, function (db, req) {
            var _q = "UPDATE admin.doc_file SET paid= not paid WHERE \"id\"='" + id + "' returning id";
            console.log(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    res.status = 500;
                    res.json({'result': 'error'});
                    return;
                }
                //photos update!
                if (userPhotosObject && userPhotosObject[user_id] && userPhotosObject[user_id].photos)
                    for (var i in userPhotosObject[user_id].photos) {
                        var photo = userPhotosObject[user_id].photos[i];
                        if (result.id == photo.id) {
                            photo.paid = !photo.paid;
                            console.log('success! ')
                            break;
                        }
                    }

                console.log('userVideosObject')
                console.log(userVideosObject)
                if (userVideosObject && userVideosObject[user_id] && userVideosObject[user_id].videos)
                    for (var i in userVideosObject[user_id].videos) {
                        var video = userVideosObject[user_id].videos[i];
                        if (result.id == video.id) {
                            video.paid = !video.paid;
                            console.log('success! ')
                            break;
                        }
                    }

                res.send({'result': 'ok'});
            });
        })
    })

    app.post('/helena/get_extra_messages', function (req, res) {
        app.getDB(req, res, function (db, req) {
            var offset = req.body.offset;
            var template = req.body.template;
            var user_id = req.session.passport.user.user_id;
            var user_id2 = req.body.user_id2;
            var _q = [
                {
                    "id": "template",
                    "query": "SELECT body from admin.doc_template where title='" + template + "' limit 1"
                },
                {
                    "id": "data", "query": "select json_agg(row_to_json(q.*)) as rows from (select *,(select price_per_unit from public.finance_service_type where service_type=5) as \
					 mess_price,(select price_per_unit from public.finance_service_type where service_type=11) as photo_price,\
					 (select dir||file_name from user_avatar_short_view where user_id=from_user_id ) as avatar_from,(select firstname \
					 from user_profile where user_id = from_user_id) as first_name,(select dir||file_name  from user_avatar_short_view \
					 where user_id=to_user_id ) as avatar_to ,to_user_id::text,from_user_id::text,message_id::text  from user_messages \
					 left join lateral (select array_agg(row_to_json(q.*)) as photos from (select * from admin.doc_file where id::bigint in \
					 (select unnest(user_messages.photos_attch)) )q  ) l on true left join lateral (select array_agg(row_to_json(q.*)) as videos from \
					 (select * from admin.doc_file where id::bigint in (select unnest(user_messages.videos_attch)) )q  ) l2 on true \
left join lateral (select array_agg(row_to_json(q.*)) as audios from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.audios_attch)) )q  ) l3 on true  \
						 where ((from_user_id='" + user_id2 + "' \
						 and to_user_id='" + user_id + "') \
						 or (from_user_id='" + user_id + "' \
						 and to_user_id='" + user_id2 + "'))\
						 order by date_sending desc \
				limit 10 OFFSET '" + offset + "')q"
                },
                {
                    "id": "count", "query": "select count(*) from user_messages WHERE  ((from_user_id='" + user_id2 + "' \
						 and to_user_id='" + user_id + "') \
						 or (from_user_id='" + user_id + "' \
						 and to_user_id='" + user_id2 + "')) "
                }
            ];

            console.log(_q)

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

                result.data.user = req.session.passport.user;
                var _resultDom = app.HandlebarsBase.compile(result.template.body.body)(result.data)
                res.send({'DOM': _resultDom, "count": result.count.count})
            });
        })
    })
    app.post('/helena/get_extra_posts', function (req, res) {
        app.getDB(req, res, function (db, req) {
            var offset = req.body.offset;
            var template = req.body.template;
            var user_id = req.session.passport.user.user_id;
            var _q = [
                {
                    "id": "template",
                    "query": "SELECT body from admin.doc_template where title='" + template + "' limit 1"
                },
                {
                    "id": "data", "query": "select json_agg(row_to_json(q.*)) as rows from (\
					select up.user_id::text,date_sending,text,firstname,lastname,comments,post_id::text,\
					(select dir||file_name from public.user_avatar_short_view  where user_id=up.user_id   ) as avatar \
					from user_posts up\
					LEFT JOIN user_profile uv ON up.user_id = uv.user_id\
						,    LATERAL ( SELECT json_agg(row_to_json(q.*)) AS comments\
						FROM ( SELECT up1.*,post_id::text,parent_post_id::text,\
                    ( SELECT user_profile.firstname\
                           FROM user_profile\
                          WHERE user_profile.user_id = up1.user_id) AS firstname,\
                    ( SELECT user_profile.lastname\
                           FROM user_profile\
                          WHERE user_profile.user_id = up1.user_id) AS lastname,(select dir||file_name from public.user_avatar_short_view  where user_id=up1.user_id   ) as avatar,\
                    up1.user_id::text AS user_id_text\
                   FROM user_posts up1\
                     LEFT JOIN user_profile uw1 ON up1.user_id = uw1.user_id\
                  WHERE up1.deleted = false AND up1.parent_post_id = up.post_id AND up1.parent_post_id <> 0\
                  ORDER BY up1.date_sending) q) ch1\
				  where parent_post_id=0 and not deleted and (up.user_id=" + user_id + " or  up.user_id in ( SELECT view_user_id FROM public.user_list where user_id =\
				  " + user_id + " and type =1 and  enabled)) order by date_sending desc\
				limit 10 OFFSET '" + offset + "')q"
                },
                {
                    "id": "count",
                    "query": "select count(*) from user_posts WHERE  not deleted and parent_post_id=0 AND (user_id='" + user_id + "' \
									OR user_id in \
					( SELECT view_user_id  FROM public.user_list where user_id =" + user_id + " and type =1 and  enabled)) "
                }
            ];


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
                var _resultDom = app.HandlebarsBase.compile(result.template.body.body)(result.data)
                res.send({'DOM': _resultDom, "count": result.count.count})
            });
        })
    })

    app.post('/helena/get_data_for_canvas', function (req, res) {

        app.getDB(req, res, function (db, req) {
            var _q = "SELECT a.id,a.file_name,a.dir,(select price_per_unit from public.finance_service_type where service_type='14') as cost from admin.doc_file a where a.id='" + req.body.photo_id + "';"

            console.log(_q)

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                //console.log('canvas photos');
                //console.log(result)
                if (err) {
                    res.status = 500;
                    res.json({'result': 'error'});
                    return;
                }

                res.send({'data': result})
            });
        })
    })

    app.post('/helena/get_photo_for_tokens', function (req, res) {
        var data = req.body;
        var user_id = req.session.passport.user.user_id;
        //обрабатываем в соответствии с алгоритмом шифрования!
        var photo_id = data.photo_id.split('_')[1];
        console.log(photo_id);

        app.getDB(req, res, function (db, req) {

            var _q = "select admin.eat_token_if_possible('" + user_id + "','" + photo_id + "','true'),a.file_name,a.dir from admin.doc_file a where a.id='" + photo_id + "';"
            console.log(_q)

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    res.status = 500;
                    res.json({'result': 'error'});
                    return;
                }

                if (result.eat_token_if_possible) {
                    paidFiles[user_id] = paidFiles[user_id] ? paidFiles[user_id] : [];
                    paidFiles[user_id].push(photo_id)
                    var file_path = (db.folder || __dirname) + result.dir + result.file_name;
                    var bitmap = fs.readFileSync(file_path);

                    // convert binary data to base64 encoded string
                    var base64 = new Buffer(bitmap).toString('base64');
                    res.send({'money': true, 'result': 'ok', 'base64': base64, 'id': photo_id.toString()})
                }
                else {
                    res.send({'money': false})
                }
            })
        })
    })

    app.post('/helena/photos', function (req, res) {

        console.log('/helena/photos');
        var isProfile = false;
        var data = req.body;
        //console.log(data)


        var user_id;
        //console.log(data)
        if (data.is_profile) {
            user_id = data.desired_id;
            isProfile = true//шифровать айди фоток!
        }
        else
            user_id = req.session.passport.user.user_id;

        var limit = parseInt(data.count);
        var offset = (data.page - 1) * limit;

        if (!userPhotosObject[user_id]) {
            userPhotosObject[user_id] = {}
            userPhotosObject[user_id]._modifying = new Promise(function (resolve, reject) {
                getUserPhotos(user_id, resolve, reject);
            })
        }
        //уменьшаем количество кода!
        userPhotosObject[user_id]._modifying = userPhotosObject[user_id]._modifying ? userPhotosObject[user_id]._modifying : Promise.resolve();
        console.log('before userPhotosObject')
        userPhotosObject[user_id]._modifying.then(function () {
            console.log('inside userPhotosObject')

            var _data_to_send = {}
            _data_to_send.photos = []
            if (userPhotosObject[user_id].photos)
            //так будет работать быстрее!
                if (isProfile)
                    for (var i = offset; i < (offset + limit); i++) {
                        var photoObjectToPush;
                        if (!userPhotosObject[user_id].photos[i])
                            continue;
                        var viewer_id = req.session.passport.user.user_id;
                        var file_id = userPhotosObject[user_id].photos[i].id;
                        var viewer_sex = req.session.passport.user.sex;

                        //проверяем не девкшка ли , или не запоатил ли мужик
                        if (viewer_sex != '2' &&
                            userPhotosObject[user_id].photos[i].paid
                            &&
                            (typeof(paidFiles[viewer_id]) == 'undefined'

                            ||
                            paidFiles[viewer_id] && paidFiles[viewer_id].indexOf(file_id) < 0)
                        )//flag for encoding
                        {
                            //TODO кодировка id
                            photoObjectToPush = userPhotosObject[user_id].photos[i]
                        }
                        else {
                            photoObjectToPush = userPhotosObject[user_id].photos[i]
                            photoObjectToPush.paid = false;
                        }
                        _data_to_send.photos.push(photoObjectToPush)
                    }
                else {
                    for (var i = offset; i < (offset + limit); i++) {
                        _data_to_send.photos.push(userPhotosObject[user_id].photos[i])
                    }
                }

            _data_to_send.amount = userPhotosObject[user_id].amount;
            //тут все ок
            //console.log(_data_to_send)
            return res.send({'res': 'ok', 'data': _data_to_send})
        })

    });

    app.post('/helena/get_video_for_tokens', function (req, res) {
        console.log('/helena/get_video_for_tokens')

        app.getDB(req, res, function (db, req) {
            var vid = req.body.id;
            var user_id = req.session.passport.user.user_id;
            console.log(req.body)
            console.log(user_id)

            var _q = "select admin.eat_token_if_possible('" + user_id + "','" + vid + "',false),a.file_name,a.dir,a.id from admin.doc_file a where a.id='" + vid + "';";
            console.log(_q)
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (result.eat_token_if_possible) {

                    paidFiles[user_id] = paidFiles[user_id] ? paidFiles[user_id] : [];
                    paidFiles[user_id].push(result.id);

                    var file_path = result.dir + result.file_name;
                    res.json({'money': true, 'result': 'ok', 'file_path': file_path, 'id': result.id});
                }
                else {
                    res.json({'money': false})
                }
            });
        })
    });

    app.post('/helena/videos', function (req, res) {
        console.log('/helena/videos');
        var user_id = req.session.passport.user.user_id;
        var isProfile = false;
        //var user_sex=req.session.passport.user.sex;

        var data = req.body;

        if (data.is_profile) {
            user_id = data.desired_id;
            isProfile = true//шифровать айди фоток!
            //console.log('LOADING VIDEOS FOR PROFILE!!!')
        }
        else
            user_id = req.session.passport.user.user_id;

        var limit = parseInt(data.count);
        var offset = (data.page - 1) * limit;


        //TODO отловить баг!
        if (!userVideosObject[user_id]) {
            userVideosObject[user_id] = {}
            userVideosObject[user_id]._modifying = new Promise(function (resolve, reject) {
                getUserVideos(user_id, resolve, reject);
            })
        }

        userVideosObject[user_id]._modifying = userVideosObject[user_id]._modifying ? userVideosObject[user_id]._modifying : Promise.resolve();

        userVideosObject[user_id]._modifying.then(function () {
            //console.log('all is _modifying!')
            var _data_to_send = {}
            _data_to_send.videos = []
            //console.log(userVideosObject[user_id])
            if (isProfile) {
                for (var i = offset; i < (offset + limit); i++) {
                    var videosObjectToPush;
                    console.log({userVideosObject});
                    if (!userVideosObject[user_id] || !userVideosObject[user_id].videos || !userVideosObject[user_id].videos[i])
                        continue;
                    var file_id = userVideosObject[user_id].videos[i].id;
                    var viewer_id = req.session.passport.user.user_id;
                    var viewer_sex = req.session.passport.user.sex;

                    if (viewer_sex != '2' &&
                        userVideosObject[user_id].videos[i].paid
                        &&
                        (typeof(paidFiles[viewer_id]) == 'undefined'

                        ||
                        paidFiles[viewer_id] && paidFiles[viewer_id].indexOf(file_id) < 0)
                    )//flag for encoding
                    {
                        //TODO кодировка id
                        //секретный алгоритм шифрования id видео
                        var videosObjectToPush = {}
                        videosObjectToPush.paid = true;
                        videosObjectToPush.id = userVideosObject[user_id].videos[i].id
                        videosObjectToPush.cost = userVideosObject[user_id].videos[i].vid_cost
                        //videosObjectToPush.cost=userVideosObject[user_id].videos[i].cost

                    }
                    else {
                        videosObjectToPush = userVideosObject[user_id].videos[i]
                        videosObjectToPush.paid = false;
                    }
                    _data_to_send.videos.push(videosObjectToPush)
                }
            }
            else if (userVideosObject[user_id].videos)
                for (var i = offset; i < (offset + limit); i++) {
                    _data_to_send.videos.push(userVideosObject[user_id].videos[i])
                }

            _data_to_send.amount = userVideosObject[user_id].amount;

            return res.send({'res': 'ok', 'data': _data_to_send})
        }).catch(console.log)
    });
    app.post('/helena/photos/delete', function (req, res) {
        var data = req.body;
        app.getDB(req, res, function (db, req) {
            var _q = "Select * from admin.doc_file where uid_upload=" + req.session.passport.user.user_id + " and id='" + data.file_id + "'"
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    console.log('file update operation was not performed due (index.js 368):');
                    console.log(err);
                    res.json({'result': 'error'});
                }
                if (!result)
                    res.end('empty')
                fs.unlink((db.folder || __dirname) + '/' + result.dir + result.file_name, function (err) {
                    if (err) res.status(500).end(err);
                    console.log("file deleted");
                    _q = "delete from admin.doc_file where uid_upload=" + req.session.passport.user.user_id + " and id='" + data.file_id + "'"
                    app.pg_request({
                        'conString': db.conString,
                        'res': res,
                        'req': req,
                        'app': app
                    }, _q, function (err, result, res) {
                        if (err) res.status(500).end(err);
                        res.send('done')
                    })
                })

            })
        })
    })

    /*----------------DATA URI (helena messages real time attachments)---------------*/
    app.post('/helena/photos/data_uri', function (req, res) {
        var imageBuffer = decodeBase64Multimedia(req.body.uri)
        var user_id = req.session.passport.user.user_id;

        app.getDB(req, res, function (db, req) {
            var name = 'img_file_' + new Date().getTime() + '.jpg';

            /*-----------NEW VERSION-----------*/
            var newDir = "files/photos/";
            var table = 'doc_file';
            var format = 'jpg';
            var temp_vals = [];
            var vals = [];
            //var field_table='';
            var size = -1;

            temp_vals.push(name, size, format, newDir, user_id);

            _.each(temp_vals, function (value) {
                if (!Array.isArray(value) || value.length > 0) {

                    if (Array.isArray(value)) {
                        var ar_type = !isNaN(value[0]) ? '::bigint[]' : '::text[]';
                        value = 'array' + JSON.stringify(value).replace(/"/g, "'") + ar_type;
                    }
                    else if (typeof value == 'object' && value != null) value = "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
                    else if (typeof value == 'string' && value != 'null') value = "'" + value.replace(/'/g, "''") + "'";
                    else if (value == null) value = 'null';

                    vals.push(value);
                }
            });


            vals.push('false')//flag of mail attachment

            console.log('before update')
            var p_field = db.pk[table];

            var _q = "INSERT INTO admin." + table + " (file_name,size,format,dir,uid_upload,mail) values (" + vals.join(",") + ") returning " + p_field + "::text,file_name,format";

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    console.log('file update operation was not performed due (index.js 368):');
                    console.log(err);
                    res.json({'result': 'error'});
                } else {
                    //создание файла
                    mkdirp((db.folder || __dirname) + newDir, function (err) {//creating directories and subdirectories recursively
                        if (err) {
                            console.error(err)
                            return res.json({
                                "res": "error",
                                "id": result.id,
                                "file_name": result.file_name,
                                "description": err
                            })
                        }
                        else
                            console.log('webcam real time attachnent');
                        console.log(newDir + '/' + result.file_name);

                        fs.writeFile((db.folder || __dirname) + '/' + newDir + '/' + result.file_name, imageBuffer.data, function (err) {
                            if (err)
                                return res.json({
                                    "res": "error",
                                    "id": result.id,
                                    "file_name": result.file_name,
                                    "description": err
                                })
                            return res.json({"res": "ok", "id": result.id, "file_name": result.file_name})
                        });

                    });
                }
            });
        });
    })

    app.get('/helena/videos_audios/data_uri/*', function (req, res) {
        console.log('---------------------HElena File')
        console.log(req.query)
        console.log(req.body)
        res.json(req.query)
    })
    app.post('/helena/videos_audios/data_uri', function (req, res) {


        var imageBuffer = decodeBase64Multimedia(req.body.uri)
        var type = req.body.type;
        //console.log(req.body.uri)

        var user_id = req.session.passport.user.user_id;

        app.getDB(req, res, function (db, req) {
            var name = 'snapshot_file_' + new Date().getTime() + '.webm';
            //var newDir = (db.folder||__dirname);
            var newDir = ""

            if (type == 'audio')
                newDir = "/files/audios/";
            else
                newDir = "/files/videos/";

            console.log(newDir)

            var table = 'doc_file';
            var format = 'webm';
            var temp_vals = [];
            var vals = [];
            //var field_table='';
            var size = -1;

            temp_vals.push(name, size, format, newDir, user_id);

            _.each(temp_vals, function (value) {
                if (!Array.isArray(value) || value.length > 0) {

                    if (Array.isArray(value)) {
                        var ar_type = !isNaN(value[0]) ? '::bigint[]' : '::text[]';
                        value = 'array' + JSON.stringify(value).replace(/"/g, "'") + ar_type;
                    }
                    else if (typeof value == 'object' && value != null) value = "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
                    else if (typeof value == 'string' && value != 'null') value = "'" + value.replace(/'/g, "''") + "'";
                    else if (value == null) value = 'null';

                    vals.push(value);
                }
            });

            vals.push('false');
            console.log('before update')
            var p_field = db.pk[table];

            var _q = "INSERT INTO admin." + table + " (file_name,size,format,dir,uid_upload,mail) values (" + vals.join(",") + ") returning " + p_field + "::text,file_name,format";

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    console.log('file update operation was not performed due (index.js 368):');
                    console.log(err);
                    res.json({'result': 'error'});
                } else {
                    //создание файла
                    console.log(newDir)
                    console.log(newDir + '/' + result.id)
                    mkdirp(newDir, function (err) {//creating directories and subdirectories recursively
                        if (err) {
                            console.error(err)
                            return res.json({"res": "error", "id": result.id, "file_name": result.file_name})
                        }
                        else

                            fs.writeFile((db.folder || __dirname) + newDir + '/' + result.file_name, imageBuffer.data, function (err) {
                                if (err) {
                                    return res.json({
                                        "res": "error",
                                        "id": result.id,
                                        "file_name": result.file_name,
                                        "description": err
                                    });
                                }
                                return res.json({"res": "ok", "id": result.id, "file_name": result.file_name});

                            });

                    });
                }
            });
        });
    })


    app.post('/helena/photos_not_actual', function (req, res) {
        console.log('/helena/photos_not_actual');
        var user_id = req.session.passport.user.user_id;
        var user_sex = req.session.passport.user.sex;
        console.log(user_id)
        userPhotosObject[user_id] = userPhotosObject[user_id] ? userPhotosObject[user_id] : {};
        /*---------new version----------------*/
        //userPhotosObject[user_id]._modifying=false;
        //TODO добавить промис!
        userPhotosObject[user_id]._modifying = new Promise(function (resolve, reject) {
            getUserPhotos(user_id, resolve, reject);
        })

        res.send({res: 'ok'})


    });

    app.post('/helena/videos_not_actual', function (req, res) {
        console.log('/helena/photos_not__modifying');
        var user_id = req.session.passport.user.user_id;
        var user_sex = req.session.passport.user.sex;
        console.log(user_id)
        userVideosObject[user_id] = userVideosObject[user_id] ? userVideosObject[user_id] : {};
        //userVideosObject[user_id]._modifying=false;
        userVideosObject[user_id]._modifying = new Promise(function (resolve, reject) {
            getUserVideos(user_id, resolve, reject);
        })
        res.send({res: 'ok'})


    });

    //////NEW+
    app.get('/helena/change_camera/:flag', function (req, res) {

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "update user_profile set cam_status=" + req.params.flag.toString() + " where user_id=" + req.session.passport.user.user_id.toString() + "";

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    return res.status(500), send(err)
                return res.json('done')//return res.json(result.data)
            });
        });

    })
    app.get('/helena/change_photo/:flag/:photo', function (req, res) {

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "update admin.doc_file set paid=" + req.params.flag.toString() + " where uid_upload=" + req.session.passport.user.user_id.toString() + " and id=" + req.params.photo + "::text";

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    return res.status(500), send(err)
                return res.json('done')//return res.json(result.data)
            });
        });

    })

    app.post('/helena/create_post/', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var user_id = req.session.passport.user.user_id.toString();
            var text = req.body.text.toString();
            var parent = req.body.parent.toString();
            var _q = "INSERT INTO user_posts(user_id,text,parent_post_id) VALUES('" + user_id + "','" + text + "','" + req.body.parent.toString()

                + "') returning (SELECT body->>'body' from admin.doc_template where title='comment_template_post' limit 1) as template,date_sending::text,post_id::text,\
			(select  count(*)+1 as post_count from user_posts where parent_post_id = 0 and\
			(user_id=" + user_id + " or user_id in (  SELECT view_user_id  FROM public.user_list where user_id =" + user_id + " and type =1 and  enabled))),\
			(select dir||file_name as avatar from public.user_avatar_short_view where user_id='" + user_id + "' limit 1)  as avatar";
            console.log(_q);

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                var data = {
                    'text': text,
                    'avatar': result.avatar,
                    'date': result.date_sending,
                    'user_id': user_id,
                    'firstname': req.session.passport.user.firstname,
                    'lastname': req.session.passport.user.lastname,
                    'post_id': result.post_id,
                    'parent': parent,
                    'post_count': result.post_count
                }
                io.sockets.in(user_id).emit('create_post', data);
                console.log(result.template)
                return res.json(app.HandlebarsBase.compile(result.template)(data))
            });
        });
    });
    app.get('/helena/create_post/:obj', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var user_id = req.session.passport.user.user_id.toString();
            var _json = JSON.parse(unescape(req.params.obj.replace(/&quot;/g, '\"')))
            console.log(_json)
            var text = _json.text.toString();
            var parent = _json.parent.toString();
            var _q = "INSERT INTO user_posts(user_id,text,parent_post_id) VALUES('" + user_id + "','" + text + "','" + parent + "') returning post_id, \
			 " + user_id + " ,date_sending::text,(select dir||file_name from user_avatar_short_view where user_id=" + user_id + " ) as avatar,\
			 (select  firstname \
			 from user_profile where user_id= "
                + req.session.passport.user.user_id.toString() + ");"
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    res.status(500).send(err)
                _json.user = result;
                _json.user_id = user_id
                // var data ={'text':text,'avatar':result.avatar,'date':result.date_sending,'user_id':user_id,'firstName':req.session.passport.user.firstname,'lastName':req.session.passport.user.lastname,
                // 'post_id':result.post_id, 'parent':parent,'post_count':result.post_count}
                // io.sockets.in(user_id).emit('create_post',data);
                //console.log(user_id+" eg "+data )
                //res.json(result.data)
                res.json(_json)
            });
        });
    });
    app.post('/helena/delete_post/', function (req, res) {
        console.log('OK')
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "update public.user_posts set deleted = true where post_id='" + req.body.idPost.toString() + "'  ";
            console.log(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                res.send('ok')//return res.json(result.data)
            });
        });


    });

    app.post('/helena/discardDelete_post/', function (req, res) {
        console.log('OK')
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "update public.user_posts set deleted = false where post_id='" + req.body.idPost.toString() + "' ";
            console.log(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                res.send('ok')//return res.json(result.data)
            });
        });
    })

    app.get('/helena/read_message/:mess', function (req, res) {

        //res.json(req.params)
        app.getDB(req, res, function (db, req) {
            var _q = "update user_messages set ispaid = true where to_user_id=" + req.session.passport.user.user_id + " and message_id=" + req.params.mess + ";" +
                "select (select count(to_user_id) from user_messages where  to_user_id='" + req.session.passport.user.user_id + "' \
			and is_view = false and visible_male is true and not ispaid and deleted is  not true) as mess_count,text,(select  balance from  user_balance_short_view where user_id=" + req.session.passport.user.user_id + " ) as money,message_id::text,photos,videos,audios from user_messages \
left join lateral (select array_agg(row_to_json(q.*)) as photos from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.photos_attch)) )q  ) l on true \
left join lateral (select array_agg(row_to_json(q.*)) as videos from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.videos_attch)) )q  ) l2 on true \
left join lateral (select array_agg(row_to_json(q.*)) as audios from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.audios_attch)) )q  ) l3 on true \
 where to_user_id=" + req.session.passport.user.user_id + " and message_id=" + req.params.mess + " and ispaid=true;"
            //res.send(_q)
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                req.params.text = result.text;

                result.user = req.session.passport.user;
                req.params.money = result.money;
                req.params.messages_id = req.params.mess;
                var _result = result;
                _q = " SELECT  body->>'body' as template FROM admin.doc_template where title='message_item_widget'"
                app.pg_request({
                    'conString': db.conString,
                    'res': res,
                    'req': req,
                    'app': app
                }, _q, function (err, result, res) {
                    req.params.photos = app.HandlebarsBase.compile(result.template)(_result);
                    req.params.videos = _result.videos;
                    req.params.audios = _result.audios;
                    req.params.mess_count = _result.mess_count
                    return res.send(req.params)

                })


            });
        })
        //фича
        //так как передается массив в данных пришлось переводить в строку
        console.log("reherherherhre")

        /*
         console.log(req.body.id)
         if(req.body&&req.session.passport.user.sex==2){
         //req.body=JSON.parse(req.body);
         //var _payable = req.body.payable
         app.getDB(req,res,function(db,req){
         res.cacheControl({'no-cache': true});
         var _q="update user_messages set is_view=true where from_user_id='"+req.body.id.toString()+"'\
         and to_user_id  ='"+req.session.passport.user.user_id.toString()+"'";
         console.log('----------');
         console.log(_q);
         console.log('--------');
         app.pg_request({'conString':db.conString,'res':res,'req':req,'app':app},_q,function(err,result,res){
         res.send('done')//return res.json(result.data)
         });
         });
         } else{res.send('done')}*/

    });

    app.get('/helena/buy_image/:id/:mess', function (req, res) {
        app.getDB(req, res, function (db, req) {

            var _q = "select _buy_file(" + req.params.id + "," + req.session.passport.user.user_id + ") "
            ///	res.json(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    res.status(500).end(err)
                //const template = result.template

                //res.json(result._buy_file)
                _q = "select (select  balance from  user_balance_short_view where user_id=" + req.session.passport.user.user_id + " ) as money,  (SELECT  body->>'body' as template \
				FROM admin.doc_template where title='message_item_widget') as template ,message_id::text,photos,videos,audios from user_messages \
		left join lateral (select array_agg(row_to_json(q.*)) as photos from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.photos_attch)) )q  ) l on true \
		left join lateral (select array_agg(row_to_json(q.*)) as videos from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.videos_attch)) )q  ) l2 on true \
		left join lateral (select array_agg(row_to_json(q.*)) as audios from (select * from admin.doc_file where id::bigint in (select unnest(user_messages.audios_attch)) )q  ) l3 on true \
		 where to_user_id=" + req.session.passport.user.user_id + " and message_id=" + req.params.mess + " and ispaid=true;"

                app.pg_request({
                    'conString': db.conString,
                    'res': res,
                    'req': req,
                    'app': app
                }, _q, function (err, result2, res) {
                    if (err)
                        res.status(500).end(err)
                    //res.json(result2.template)
                    res.json(app.HandlebarsBase.compile(result2.template)(result2));
                    res.json(app.HandlebarsBase.compile(result2.template)(result2))
                });
            });
        })

    });

    /*

     */
    app.get("/helena/videos_audios/upload/", function (req, res) {
        //console.log(req)
        res.send("wegewgwe")
    })
    app.post("/helena/videos_audios/upload", function (req, res) {
        var params = req.params;
        console.log({body: req.body})
        var _file = req.files;
        res.json(_file)
    })
    app.get('/helena/buy_private_image/:id', function (req, res) {
        app.getDB(req, res, function (db, req) {

            var _q = "select _buy_file(" + req.params.id + "," + req.session.passport.user.user_id + ",14);"
            ///	res.json(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    res.status(500).end(err)
                console.log(result)
                res.json(result._buy_file)
            });
        })

    });

    app.post('/api/helena/buy_image/:id', function (req, res) {
        app.getDB(req, res, function (db, req) {

            var _q = "select _buy_file(" + req.params.id + "," + req.session.passport.user.user_id + ");"
            ///	res.json(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err)
                    res.status(500).end(err)
                console.log(result)

                res.json(result._buy_file)
            });
        })

    });


    app.post('/helena/get_tokens_status', function (req, res) {
        app.getDB(req, res, function (db, req) {
            var user_id = req.session.passport.user.user_id;
            var _q = "select balance from user_balance_short_view where user_id='" + user_id + "'";
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                return res.send(result)
            });
        });

    });

    app.post('/helena/read_order', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "update user_service_order set " + ((req.session.passport.user.sex == 1) ? ("user_saw") : ("view_user_saw")) + "=true where  \
				(" + ((req.session.passport.user.sex == 1) ? ("user_id") : ("view_user_id")) + "='" + req.session.passport.user.user_id.toString() + "' and type=" + req.body.type + ") ";
            console.log("----------------------------------------");
            console.log(_q);
            console.log("----------------------------------------");
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                res.send('done')//return res.json(result.data)
            });
        });
    });
    app.get('/helena/upload/files/:obj', function (req, res) {
        res.json(req.params)

    })
    app.post('/helena/send_message/', function (req, res) {

        //req.body=JSON.parse(unescape((req.body.data).replace(/&quot;/g, '\"')));

        var data = JSON.parse(req.body.data)
        var photos = data.photos||'';
        var videos = data.videos||'';
        var audios = data.audios||'';
        var _text = data.message_text
        var _payable = data.payable;
        if (req.session.passport.user.sex == 2 && _text.length < 200)
            res.status(500).end("Your text has less than 200 symbols")
        const _old_text = _text.replace(/\n/g, '<br>')
        _text = _old_text.replace(/\'/g, "''")
        app.getDB(req, res, function (db, req) {

            //res.cacheControl({'no-cache': true});
            /*
             var photos = [];
             var videos = [];
             var audios = [];
             var photo_format = ['jpeg','jfif','jpg','exif','tiff','bmp','png','ppm', 'pgm', 'pbm', 'pnm','bpg'];
             var video_format = ['webm','flv','mkv','gif','gifv','avi','wmv','mov','mp4','m4p','mpeg','3gp','f4v', 'f4p' ,'f4a','f4b'];
             var audio_format = ['3gp','aa','aac','aax','act','aiff','amr','ape','au','awb','dct','dss','dvf','flac','gsm','iklax','ivs',
             'm4a','m4b','m4p','mmf','mp3','mpc','msv','ogg','oga','mogg','opus','ra','rm','raw','sln','tta','vox','wav','wma','wv','webm'];
             req.body.files.forEach(function(element){
             var format = element.split('.');
             format = format[format.length];
             if(photo_format.indexOf(format.toLowerCase())>=0)
             photos.push();
             if(video_format.indexOf(format.toLowerCase())>=0)
             videos.push();
             if(audio_format.indexOf(format.toLowerCase())>=0)
             audios.push();
             })
             var data = {"videos":videos,"photos":photos,"audios":audios};
             res.json(data)*/
             let photos_additional =  ((photos.length >= 1) ? ("," + photos) : "")
             let videos_additional =  ((videos.length >= 1) ? ("," + videos) : "")
             let audios_additional =  ((audios.length >= 1) ? ("," + audios) : "")
            var _q = `INSERT into user_messages (from_user_id,to_user_id,text,type,photos_attch,videos_attch,audios_attch) values
             (${req.session.passport.user.user_id.toString()},${data.id2},'${_text}',1,
             ARRAY [${photos}]::bigint[] ,ARRAY [${videos}] ::bigint[],ARRAY[${audios}]::bigint[]);
			Select (select message_id from user_messages where from_user_id = ${req.session.passport.user.user_id.toString()} and 
            to_user_id = ${data.id2} order by date_sending  desc limit 1) as message_id
			,(select dir||file_name from user_avatar_short_view where user_id=${req.session.passport.user.user_id.toString()}) as avatar ,
			(select json_agg(row_to_json(doc_file.*))  as file_list from admin.doc_file where id::bigint  in 
			(1${photos_additional})) as photos
			,(select json_agg(row_to_json(doc_file.*))  as file_list from admin.doc_file where id::bigint  in 
			(1${videos_additional})) as videos
			,(select json_agg(row_to_json(doc_file.*))  as file_list from admin.doc_file where id::bigint  in 
			(1${audios_additional})) as audios,
             (SELECT  body->>'body' as template FROM admin.doc_template where title='my_mail_template') as template,
             (SELECT  body->>'body' as template FROM admin.doc_template where title='email_mail') as mail_template,
             (SELECT  email FROM public.user_profile where user_id=${data.id2}) as user_email`
            //res.end(_q)
            //	res.json(_q)
            /*res.end(_q);
             var _q="select * from send_message('"+req.session.passport.user.user_id.toString()+"','"+req.body.id2.toString()+"','"+_text+"','"+req.body.type.toString()+"',\
             array["+req.body.photos.toString()+"]::bigint[],array["+req.body.videos.toString()+"]::bigint[],array["+req.body.audios.toString()+"]::bigint[],"+_payable+")";
             */
//res.json(_q)
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Вам сообщение с HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email
                }
                sendMail_notif(email_data);
                if (err)
                    res.status(500).end(err)
                //	return res.json(result)
                var ret_data = {
                    "photos": result.photos,
                    "videos": result.videos,
                    "audios": result.audios,
                    "date_sending": result.date_sending,
                    "avatar": result.avatar,
                    "text": _old_text,
                    "user": req.session.passport.user,
                    "message_id": result.message_id
                }
                return res.json(app.HandlebarsBase.compile(result.template)(ret_data))
                // 	if(err){
                // 		res.stasus(500).end(end)
                // 	}

                /*message=_text;
                 var photos_attch;
                 var videos_attch;
                 var audios_attch;
                 var addition="";

                 if(result.photos_attch.length>0 ||result.videos_attch.length>0 ||result.audios_attch.length >0){
                 addition="С мультимедиа";//?????????
                 }
                 if(req.session.passport.user.sex==1){
                 photos_attch = result.photos_attch;
                 videos_attch = result.videos_attch;
                 audios_attch = result.audios_attch;
                 }
                 else
                 message = '<a onclick="read_pay_message('+result.message_id+','+req.session.passport.user.user_id.toString()+')">'+message.substr(0,4)+'...'+addition+'</a>';

                 for(var i in smilesConf){
                 var regex=new RegExp(escapeRegExp(i.toString()),'gi')
                 message=message.replace(regex,'<img src="../'+smilesConf[i]+'"">')
                 }

                 var user_id=req.body.id2;
                 var data ={'id':req.session.passport.user.user_id,'notread':result.notread,'firstname':req.session.passport.user.firstname,
                 'lastname':req.session.passport.user.lastname,'message':message,'sex':req.session.passport.user.sex,
                 'date':result.date_sending,'payable':_payable,'idTo':user_id,'photos_attch':photos_attch,'videos_attch':videos_attch,
                 'notread_this':result.notread_this,    'audios_attch':audios_attch,'message_id':result.message_id}

                 io.sockets.in(user_id).emit('SendMail',data );
                 return res.json({'audios_attch':result.audios_attch,'photos_attch':result.photos_attch,'videos_attch':result.videos_attch})*/


            });
        });
    });
    app.post('/helena/get_time_zone', (req, res) => {
        var time = req.body.time.split("-")[0]
        console.log(time)

        app.getDB(req, res, function (db, req) {
            var _q = "SELECT data as timezone,(select data  FROM admin.doc_cls where parent\
			  		 =11 and id = " + req.session.passport.user.map_city_id + ") as my_tz,to_char((('" + time + "'::time -  (SELECT data::text FROM admin.doc_cls where parent =11 \
				and id = (select map_city_id from user_profile where user_id = " + req.session.passport.user.user_id.toString() + "))::interval)  + data::interval),'HH24') as time,\
					to_char(( ((('" + req.body.date + "'::date || ' '||'" + time + "'::time)::timestamp -  (SELECT data::text FROM admin.doc_cls where parent =11 \
				and id = (select map_city_id from user_profile where user_id = " + req.session.passport.user.user_id.toString() + "))::interval) \
				+ data::interval))::date,'DD.MM.YYYY') as date_user  FROM admin.doc_cls where parent\
			  		 =11 and id = (select map_city_id from user_profile where user_id = " + req.body.user_2 + ")"

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                //console.log(_q)
                result.time = result.time + ':00 - ' + (+result.time + 1) + ':00'
                res.json(result)
            })
        })
    })


    app.post('/helena/send_video_date/', function (req, res) {
        var TYPE_VIDEODATE = 16;
        var user_id = req.session.passport.user.user_id.toString();
        console.log('/helena/send_video_date/');
        console.log(user_tokens[user_id]);
        console.log(rateChatType[TYPE_VIDEODATE]);

        if (user_tokens[user_id] < rateChatType[TYPE_VIDEODATE])
            return res.send({'result': 'error', 'description': 'not enought tokens'});

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});

            var _q = "INSERT INTO user_service_order(user_id, view_user_id, type, time_zone,date_destination,time_period,user_status) \
					VALUES('" + req.session.passport.user.user_id.toString() + "','" + req.body.partner_id.toString() + "',3,'" + req.body.time_zone.toString() + "','" + req.body.date_destination.toString() + "','" + req.body.time_from.toString() + /*" - "+req.params.time_to.toString()+*/"',2);\
					insert into  user_credit (men_id,women_id,credit,credit_type,service_type) \
	values (" + req.session.passport.user.user_id.toString() + "," + req.body.partner_id.toString() + ",\
	(select price_per_unit from finance_service_type where service_type=" + TYPE_VIDEODATE + "),2," + TYPE_VIDEODATE + ");\
					\
					INSERT INTO user_messages(from_user_id,to_user_id,text,type) VALUES('0','" + req.body.partner_id.toString() + "','Джентльмен " + req.session.passport.user.firstname + " пригласил Вас \
					на видео свидание. Для подтверждения, участия в  свидании или отказа просьба перейти в раздел My dates',1);\
					select (Select count(user_id) as notsaw From user_service_order_view where (user_id='" + req.body.partner_id.toString() + "' \
					or view_user_id='" + req.body.partner_id.toString() + "') and type=3 and " + ((req.session.passport.user.sex == 2) ? (" user_saw is false") : (" view_user_saw is false")) + "),(\
			 Select count(to_user_id) as notRead from user_messages_view where " + ((req.session.passport.user.sex == 1) ? ("visible_male") : ("visible_female")) + " is true and to_user_id='" + req.body.partner_id + "' and is_view = false)";
            console.log("--------------------------------------");
            console.log(_q);
            console.log("--------------------------------------");
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                console.log(result);
                var _q = "";
                var message = "" + req.body.time_zone.toString() + " " + req.body.date_destination.toString() + " " + req.body.time_from.toString() + "";
                var user_id = req.body.partner_id;
                var data = {
                    'id': req.session.passport.user.user_id,
                    'notsaw': result.notsaw,
                    'notread': result.notread,
                    'firstname': req.session.passport.user.firstname,
                    'lastname': req.session.passport.user.lastname,
                    'message': message
                }
                console.log(result);
                res.json('done');
                io.sockets.in(user_id).emit('SendVideoDate', data);
            });

        });
    });
    app.get('/helena/send_video_date/:obj', function (req, res) {
        var TYPE_VIDEODATE = 16;
        var user_id = req.session.passport.user.user_id.toString();
        console.log('/helena/send_video_date/');


        //can't find user_id of undefined
        //console.log(user_tokens[user_id]);
        //console.log(rateChatType[TYPE_VIDEODATE]);

        var _json = JSON.parse(unescape((req.params.obj).replace(/&quot;/g, '\"')))

        //res.json(_json)


        //can't find user_id of undefined
        // if (user_tokens[user_id] < rateChatType[TYPE_VIDEODATE])
        //     return res.send({'result': 'error', 'description': 'not enought tokens'});

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            /*

             select to_char(( '"+_json.time_from.toString()+"' -  '3 hour'::interval)  + data::interval,'HH24') FROM admin.doc_cls where parent

             =11 and id = (select map_city_id from user_profile where user_id = "+req.session.passport.user.user_id+")


             select

             ( ((('"+_json.date_destination.toString()+"' || ' '||'"+_json.time_from.toString()+"')::timestamp )  - data::interval))::date FROM admin.doc_cls where parent

             =11 and id = (select map_city_id from user_profile where user_id =  "+req.session.passport.user.user_id+")

             */
            var _q = `INSERT INTO user_service_order(user_id, view_user_id, type,time_period, date_destination,user_status) 
					VALUES('${req.session.passport.user.user_id.toString()}','${_json.partner_id.toString()}',3,
					(select to_char(( '${_json.time_from.toString()}' )  - data::interval,'HH24') FROM admin.doc_cls where parent 
						=11 and id = (select map_city_id from user_profile where user_id = ${req.session.passport.user.user_id}))
					||':00',(select  ((('${_json.date_destination.toString()}'::date || ' '||'${_json.time_from.toString()}')::timestamp ) 
                     - data::interval)::date FROM admin.doc_cls where parent =
						11 and id = (select map_city_id from user_profile where user_id = ${req.session.passport.user.user_id})),2);
					insert into  user_credit (men_id,women_id,credit,credit_type,service_type) 
                	values (${req.session.passport.user.user_id.toString()},${_json.partner_id.toString() },
                	(select price_per_unit from finance_service_type where service_type=${TYPE_VIDEODATE}),2,${TYPE_VIDEODATE});
                    select      (SELECT  body->>'body' as template FROM admin.doc_template where title='email_videodate') as mail_template,
                                (SELECT  email FROM public.user_profile where user_id=${_json.partner_id.toString()}) as user_email`
            /*\
             select (Select count(user_id) as notsaw From user_service_order_view where (user_id='"+_json.partner_id.toString()+"' \
             or view_user_id='"+_json.partner_id.toString()+"') and type=3 and "+((req.session.passport.user.sex==2)?(" user_saw is false"):(" view_user_saw is false"))+"),(\
             Select count(to_user_id) as notRead from user_messages_view where "+((req.session.passport.user.sex==1)?("visible_male"):("visible_female"))+" is true and to_user_id='"+_json.partner_id+"' and is_view = false)";	*/

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Вас пригласили на видео свидание с HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email
                }
                sendMail_notif(email_data);
                console.log(result);
                var _q = "";
                var message = " " + _json.date_destination.toString() + " " + _json.time_from.toString() + "";
                var user_id = _json.partner_id;
                var data = {
                    'id': req.session.passport.user.user_id,
                    'notsaw': result.notsaw,
                    'notread': result.notread,
                    'firstname': req.session.passport.user.firstname,
                    'lastname': req.session.passport.user.lastname,
                    'message': message
                }
                console.log(result);
                res.json('done');
                io.sockets.in(user_id).emit('SendVideoDate', data);
            });

        });
    });


    app.post('/helena/call_me/', function (req, res) {
        var TYPE_CALL = 17;

        var user_id = req.session.passport.user.user_id.toString();
        console.log('/helena/call_me/');
        console.log(user_tokens[user_id]);
        console.log(rateChatType[TYPE_CALL]);

        if (user_tokens[user_id] < rateChatType[TYPE_CALL])
            return res.send({'result': 'error', 'description': 'not enought tokens'})

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "INSERT INTO user_service_order(user_id, view_user_id, type, time_zone,date_destination,time_period,contact_phone,alternate_contact_phone,contact_email,user_status) \
					VALUES('" + req.body.user_id.toString() + "','" + req.body.partner_id.toString() + "',1,'" + req.body.time_zone.toString() + "','" + req.body.date_destination.toString() + "','" + req.body.time_from.toString() + "','" + req.body.phone1.toString() + "',\
					'" + req.body.phone2.toString() + "','" + req.body.email.toString() + /*" - "+req.params.time_to.toString()+*/"',2);\
					insert into  user_credit (men_id,women_id,credit,credit_type,service_type) \
					values (" + req.session.passport.user.user_id.toString() + "," + req.body.partner_id.toString() + ",\
					(select price_per_unit from finance_service_type where service_type=" + TYPE_CALL + "),2," + TYPE_CALL + ");\
					INSERT INTO user_messages(from_user_id,to_user_id,text,type) VALUES('0','" + req.body.partner_id.toString() + "','Джентльмен " + req.session.passport.user.firstname + " хочет вам Вам позвонить \
					. Для подтверждения или отказа просьба перейти в раздел My calls',1);\
					Select (Select count(user_id) as notsaw From user_service_order_view where (user_id='" + req.body.partner_id.toString() + "' \
					or view_user_id='" + req.body.partner_id.toString() + "') and type=1 and (view_user_status in ( 1,2) or user_status in (1,2))),(\
			 Select count(to_user_id) as notRead from user_messages_view where " + ((req.session.passport.user.sex == 1) ? ("visible_male") : ("visible_female")) + " is true and to_user_id='" + req.body.partner_id + "' and is_view = false)";
            console.log(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                console.log(result);
                var _q = "";
                var message = "" + req.body.time_zone.toString() + " " + req.body.date_destination.toString() + " " + req.body.time_from.toString() + "<br>"
                var user_id = req.body.partner_id;
                var data = {
                    'id': req.session.passport.user.user_id,
                    'notsaw': result.notsaw,
                    'notread': result.notread,
                    'firstname': req.session.passport.user.firstname,
                    'lastname': req.session.passport.user.lastname,
                    'message': message
                }
                res.json('done')//return res.json(result.data)
                io.sockets.in(user_id).emit('SendCallMe', data);
            });
        });
    });
    app.get('/helena/call_me/:obj', function (req, res) {
        var TYPE_CALL = 17;

        var user_id = req.session.passport.user.user_id.toString();
        console.log('/helena/call_me/');


        //user_tokens is undefined
        // console.log(user_tokens[user_id]);
        // console.log(rateChatType[TYPE_CALL]);



        var _json = JSON.parse(unescape((req.params.obj).replace(/&quot;/g, '\"')))
        //res.json(_json)


        //user_tokens is undefined
        // if (user_tokens[user_id] < rateChatType[TYPE_CALL])
        //     return res.send({'result': 'error', 'description': 'not enought tokens'})

        let phone1 = _json.phone_con1.toString() + _json.phone_reg1.toString() + _json.phone_num1.toString() ;
        let phone2 = _json.phone_con2.toString() + _json.phone_reg2.toString() + _json.phone_num2.toString() ;
        let male_vivibility = ((req.session.passport.user.sex == 1) ? ("visible_male") : ("visible_female"))
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = `INSERT INTO user_service_order(user_id, view_user_id, type, time_period,date_destination,contact_phone,alternate_contact_phone,user_status) 
					VALUES('${user_id.toString()}','${_json.partner_id.toString()}',1,(select to_char(( '${_json.time_from.toString()}' )  - data::interval,'HH24') 
                    FROM admin.doc_cls where parent 
						=11 and id = (select map_city_id from user_profile where user_id = ${req.session.passport.user.user_id}))
					||':00',(select  ((('${_json.date_destination.toString()}'::date || ' '||'${_json.time_from.toString()}
                ')::timestamp )  - data::interval)::date FROM admin.doc_cls where parent =
						11 and id = (select map_city_id from user_profile where user_id =  ${req.session.passport.user.user_id })),'${phone1}',
					'${phone2}',2);
					insert into  user_credit (men_id,women_id,credit,credit_type,service_type) 
					values (${user_id},${_json.partner_id.toString()},
					(select price_per_unit from finance_service_type where service_type=${TYPE_CALL}),2,${TYPE_CALL});
					Select (Select count(user_id) as notsaw From user_service_order_view where (user_id='${_json.partner_id.toString()}' 
                    or view_user_id='${_json.partner_id.toString()}') and type=1 and (view_user_status in ( 1,2) or user_status in (1,2))),(
			 Select count(to_user_id) as notRead from user_messages where ${male_vivibility} is true and to_user_id='${_json.partner_id}' 
             and is_view = false),(SELECT  body->>'body' as template FROM admin.doc_template where title='email_call') as mail_template,
                                (SELECT  email FROM public.user_profile where user_id=${_json.partner_id.toString()}) as user_email`;
            console.log(_q);
            //res.send(_q)
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Вам хотят позвонить с HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email
                }
                sendMail_notif(email_data);
                console.log(result);
                // var message = " "+req.body.date_destination.toString()+" "+req.body.time_from.toString()+"<br>"
                // var user_id=req.body.partner_id;
                // var data ={'id':req.session.passport.user.user_id,'notsaw':result.notsaw,'notread':result.notread,'firstname':req.session.passport.user.firstname,'lastname':req.session.passport.user.lastname,'message':message}
                res.json('done')//return res.json(result.data)
                // io.sockets.in(user_id).emit('SendCallMe',data );
            });
        });
    });
    app.post('/helena/delete/mess/:id', function (req, res) {

        app.getDB(req, res, function (db, req) {
            var _q = `update public.user_messages set deleted = true where message_id= ${req.params.id} and from_user_id=${req.session.passport.user.user_id}`;
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                console.log(result);
                if (err)
                    res.status(500).send(err)
                res.send('Ok')
            });
        });

    })
    app.post('/helena/search_users', function (req, res) {

        app.getDB(req, res, function (db, req) {

            var _q = `select public._user_search_filter('${req.body.query}',${req.body.offset},'${req.session.passport.user.user_id}')`;

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                var data = (result._user_search_filter)
                _q = `select body->>'body' as data from admin.doc_template where title='search_template';`;
                app.pg_request({
                    'conString': db.conString,
                    'res': res,
                    'req': req,
                    'app': app
                }, _q, function (err, result, res) {
                    //res.send(result.data)
                    res.json({"DOM": app.HandlebarsBase.compile(result.data)(data), count: data.count})
                })
            })
        })
    })
    app.post('/helena/date_me', function (req, res) {

        var TYPE_DATE = 10

        var user_id = req.session.passport.user.user_id.toString()

        if (user_tokens[user_id] < rateChatType[TYPE_DATE])
            return res.send({'result': 'error', 'description': 'not enought tokens'})

        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "";
            console.log(_q);
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                var _q = `INSERT INTO user_service_order(user_id, view_user_id, type, message ,user_status) 
                    VALUES('${req.session.passport.user.user_id.toString()}','${req.body.id.toString()}',2,'${req.body.text.toString()}',2);
                    select (SELECT  body->>'body' as template FROM admin.doc_template where title='email_date') as mail_template,
                                (SELECT  email FROM public.user_profile where user_id=${_json.partner_id.toString()}) as user_email`;
                app.pg_request({
                    'conString': db.conString,
                    'res': res,
                    'req': req,
                    'app': app
                }, _q, function (err, result, res) {
                    let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Вам хотят позвонить с HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email
                }
                sendMail_notif(email_data);
                    console.log(result);
                    if (err)
                        res.status(500).send(err)
                    res.seng('Ok')
                    var _q = "";

                    app.pg_request({
                        'conString': db.conString,
                        'res': res,
                        'req': req,
                        'app': app
                    }, _q, function (err, result, res) {
                        return res.json('done')//return res.json(result.data)
                    });
                });
            });
        });
    });
    app.get('/helena/date_me/:obj', function (req, res) {

        var TYPE_DATE = 10

        var _json = JSON.parse(unescape((req.params.obj).replace(/&quot;/g, '\"')))
        var user_id = req.session.passport.user.user_id.toString()


        // if (user_tokens[user_id] < rateChatType[TYPE_DATE])
        //     return res.send({'result': 'error', 'description': 'not enought tokens'})
        console.log(_json)
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = `INSERT INTO user_service_order(user_id, view_user_id, type, message ,user_status) 
                VALUES('${req.session.passport.user.user_id.toString()}','${_json.id.toString()}',2,'${_json.text.toString()}',2);
                select (SELECT  body->>'body' as template FROM admin.doc_template where title='email_date') as mail_template,
                (SELECT  email FROM public.user_profile where user_id=${_json.id.toString()}) as user_email`;
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Вас пригласили на свидание с HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email
                }
                sendMail_notif(email_data);
                console.log(result);
                if (err)
                    res.status(500).send(err)
                //res.send('Ok')
                res.send("OK")
                //  res.json({status:'done'})//return res.json(result.data)

            });
        });
    });

    app.get('/helena/change_order/:obj', function (req, res) {

        var TYPE_DATE = 10

        var _json = JSON.parse(unescape((req.params.obj).replace(/&quot;/g, '\"')))
        var user_id = req.session.passport.user.user_id.toString()
        //res.json(_json)
        var _q = "update  user_service_order set " + ((req.session.passport.user.sex == 1) ?
                " user_status = 2 , view_user_status=1" :
                " view_user_status=2, user_status =1 ") + " ,time_period=(select to_char(( '" + _json.time_from.toString() + "' )  - data::interval,'HH24') FROM admin.doc_cls where parent \
		=11 and id = (select map_city_id from user_profile where user_id = " + req.session.passport.user.user_id + "))\
						||':00' , date_destination = (select  ((('" + _json.date_destination.toString() + "'::date || ' '||'" + _json.time_from.toString() +
            "')::timestamp )  - data::interval)::date FROM admin.doc_cls where parent =\
					11 and id = (select map_city_id from user_profile where user_id =  " + req.session.passport.user.user_id + "))   where service_order_id=" + _json.id+";"
        //res.json(_q)

            let user_query = ((req.session.passport.user.sex == 1)?" view_user_id  ":" user_id ")
        _q+= `select 
            (SELECT  body->>'body' as template FROM admin.doc_template where title='email_change_time') as mail_template,
                                (SELECT  email FROM public.user_profile where user_id=(select ${user_query} 
                                from user_service_order where service_order_id=${_json.id.toString()} )) as user_email,
                                (select type  from user_service_order where  service_order_id=${_json.id.toString()}) as order_type`

        app.getDB(req, res, function (db, req) {

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {

                if (err) {
                    res.status(500).end(err)
                }

                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Время сервиса изменилось HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email,
                    order_type:       result.order_type
                }
                sendMail_notif(email_data);
                res.send("ok")
            })
        })

    });
    app.post('/api/helena/change_state/:stat/:id/', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            let _q = "";
            if (req.session.passport.user.sex == 1) {
                _q = ` update user_service_order set user_status=${req.params.stat.toString()}
                 where service_order_id='${req.params.id.toString()}' and user_id = '${req.session.passport.user.user_id.toString()}' `;
                }   else  {
                _q = `update user_service_order set view_user_status=${req.params.stat.toString()} 
                where service_order_id='${req.params.id.toString()}'  and view_user_id = '${req.session.passport.user.user_id.toString()}'`;
                }
            let user_query = ((req.session.passport.user.sex == 1)?" view_user_id  ":" user_id ")
            
            _q += `returning user_id as man_id,view_user_id as woman_id,type,user_status,view_user_status ,
            (SELECT  body->>'body' as template FROM admin.doc_template where title='email_change_state') as mail_template,
                                (SELECT  email FROM public.user_profile where user_id=(select ${user_query} 
                                from user_service_order where service_order_id=${req.params.id.toString()} )) as user_email,
                                (select type  from user_service_order where  service_order_id=${req.params.id.toString()}) as order_type`
            console.log(_q)

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                let email_data = {
                    user_name:        req.session.passport.user.firstname,
                    user_id:          req.session.passport.user.user_id,
                    host:             (req.protocol + '://' + req.get('host') ),
                    subject:          'Состояние сервиса изменилось HelenaDate',
                    mail_template:    result.mail_template,
                    user_email:       result.user_email,
                    order_type:       result.order_type,
                    order_state:      req.params.stat.toString()
                }
                sendMail_notif(email_data);
                var data = {
                    "id": req.params.id.toString(),
                    "sex": req.session.passport.user.sex.toString(),
                    "view_user_status": result.view_user_status,
                    "user_status": result.user_status
                }
                res.send('done');//return res.json(result.data)
                io.sockets.in(req.session.passport.user.user_id).emit('changedStatus', data);
                //компенсация денег!!!!
                if (result.user_status == '3') {
                    var _data = {
                        'user_id': result.man_id,
                        'tokens': rateChatType[(result.type == 3 ? 16 : 16)],//TODO добавить проверку на другие типы
                        'woman_id': result.woman_id
                    }
                    returnTokens(_data)
                }
            });
        });
    });
    app.post('/api/helena/del_file/:id', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "delete from admin.doc_file where id=" + req.params.id.toString() + "::text and uid_upload=" + req.session.passport.user.user_id.toString();

            console.log(_q);
            res.send(_q)

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                res.send('done');//return res.json(result.data)
                returnTokens(_data)

            });
        });
    });

    app.post('/helena/change_date/', function (req, res) {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "";

            var time_from = req.body.time_from;
            s
            var _date = (req.body.date).split("/");
            var date = _date[2] + "-" + _date[0] + "-" + _date[1];
            if (req.session.passport.user.sex == 2) {
                _q = "update user_service_order set user_status=1,view_user_status=3,time_period='" + time_from.toString() + "',\
                date_destination='" + date.toString() + "'::date where service_order_id='" + req.body.id.toString() + "'";
            } else {
                _q = "update user_service_order set view_user_status=1,user_status=2,time_period='" + time_from.toString() + "',\
                date_destination='" + date.toString() + "'::date where service_order_id='" + req.body.id.toString() + "'";

            }
            _q += " returning user_status,view_user_status,time_zone";

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                var data = {
                    "id": req.body.id.toString(), "sex": req.session.passport.user.sex.toString(),
                    "time_zone": result.time_zone, "view_user_status": result.view_user_status,
                    "user_status": result.user_status, "date": date, "time_from": time_from
                }
                res.send('done');//return res.json(result.data)
                io.sockets.in(req.session.passport.user.user_id).emit('changedDate', data);
            });
        });
    });

    app.post('/helena/send_gift/', function (req, res) {
        //тут проверка в функции pay_virt_gift
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = "select public.pay_virt_gift('" + req.body.gift.toString() + "','" + req.session.passport.user.user_id.toString() + "','" + req.body.partnet_id.toString() + "','" + req.body.text + "')";
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                return res.json(result)//res.json(result.data)
            });
        });
    });
    app.post('/helena/get/list_real_gift', (req, res) => {
        app.getDB(req, res, function (db, req) {
            res.cacheControl({'no-cache': true});
            var _q = `select * from gifts where gift_category_id=2 and gift_id in (${req.body.gifts})`;
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                return res.json(result)//res.json(result.data)
            });
        });
    })

    app.post('/mess_list/', (req, res) => {
        var user_sex = req.session.passport.user.sex;
        var user_id = req.session.passport.user.user_id;
        var data = req.body;
        var partner_id = data.partner_id;
        var template = data.template;

        app.getDB(req, res, function (db, req) {
            var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, template, res) {
                if (err) {
                    res.status = 500;
                    res.json({'result': 'error'});
                    return;
                }

                var _q = "";
                var _q_count = "";

                if (user_sex == '1') {
                    _q = "select json_agg(row_to_json(q)) as rows from (select *,'" + partner_id + "' as partner_id,'" + user_id + "' as my_user_id,'" + user_sex + "' as my_sex,"
                        +
                        " (select photos_attch from message_attachments_view where a.message_id=message_id) as photos, (select videos_attch from message_attachments_view where a.message_id=message_id)"
                        +
                        " as videos, (select audios_attch from message_attachments_view where a.message_id=message_id) as audios "
                        + " from user_messages_view a "
                        + " where ((from_user_id='" + partner_id + "'  and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + partner_id + "')) and visible_male =true "
                        + " order by date_sending desc "
                        +
                        " limit '" + data.limit + "' "
                        +
                        " offset '" + data.offset + "' )q";
                }
                else if (user_sex == '2') {
                    //запрос на сообщения!
                    _q = "select json_agg(row_to_json(q)) as rows from (select *,'" + partner_id + "' as partner_id,'" + user_id + "' as my_user_id,'" + user_sex + "' as my_sex, (select photos_attch from message_attachments_view where a.message_id=message_id) "
                        +
                        " as photos, (select videos_attch from message_attachments_view where a.message_id=message_id) as videos, (select audios_attch from message_attachments_view where a.message_id=message_id) as audios "
                        +
                        " from user_messages_view a "
                        +
                        " where ((from_user_id='" + partner_id + "'  and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + partner_id + "')) and visible_female =true "
                        +
                        " order by date_sending desc "
                        +
                        " limit '" + data.limit + "' "
                        +
                        " offset '" + data.offset + "' )q";

                }
                else {
                    return res.send({'result': 'error', 'desc': 'user sex is not set'});
                }
                //запрос реального их количества
                _q_count = "select count(*) from user_messages_view a "
                    +
                    " where ((from_user_id='" + partner_id + "'  and to_user_id='" + user_id + "') or (from_user_id='" + user_id + "' and to_user_id='" + partner_id + "')) and visible_female =true "
                //скоуп
                res.q = _q;

                app.pg_request({
                    'conString': db.conString,
                    'res': res,
                    'req': req,
                    'app': app
                }, _q_count, function (err, count, res) {
                    if (err) {
                        res.status = 500;
                        res.json({'result': 'error'});
                        return;
                    }
                    app.pg_request({
                        'conString': db.conString,
                        'res': res,
                        'req': req,
                        'app': app
                    }, res.q, function (err, messages, res) {
                        if (err) {
                            res.status = 500;
                            res.json({'result': 'error'});
                            return;
                        }
                        var _template = template.data;
                        res.send({
                            'data': app.HandlebarsBase.compile(_template || '')(messages),
                            'amount': count.count
                        });
                    });
                });

            });
        })
    });

    //
    app.post('/helena/order_real_gift', (req, res) => {
        //TODO requst to DB
        console.log('/helena/order_real_gift');
        app.getDB(req, res, function (db, req) {

            //webird thing are gere
            console.log(req.body)
            var items_arr = req.body['items[]'];
            console.log(items_arr)

            var from_user_id = req.session.passport.user.user_id;
            var to_user_id = req.body.girl_id;
            var message = req.body.message;

            //функция
            var _q = "select public.pay_real_gifts('" + from_user_id + "', '" + to_user_id + "', '" + message + "', array[" + (Array.isArray(items_arr) ? items_arr.join(',') : items_arr) + "])";
            console.log(_q);

            app.pg_request({
                'conString': db.conString,
                'res': res,
                'req': req,
                'app': app
            }, _q, function (err, result, res) {
                if (err) {
                    res.status(500)
                    return res.send({'status': 'error', 'description': err.toString()});
                }
                res.send({'result': result.pay_real_gifts});
            });
        });
    });

    //////NEW-

    function decodeBase64Multimedia(dataString) {
        var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
            response = {};

        if (matches.length !== 3) {
            return new Error('Invalid input string');
        }

        response.type = matches[1];
        response.data = new Buffer(matches[2], 'base64');

        return response;
    }

    function escapeRegExp(str) {
        return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    }

    function changePaidFlag(data) {
        console.log(data)
        var id = data.id,
            type = data.type,
            user_id = data.user_id;

        console.log('changePaidFlag function');

        //проблемы с синхронизацией!
        if (type == 'image') {
            if (userPhotosObject[user_id] && userPhotosObject[user_id].photos)
                for (var i in userPhotosObject[user_id].photos) {
                    if (!userPhotosObject[user_id].photos.hasOwnProperty(i))
                        continue;
                    if (userPhotosObject[user_id].photos[i].id == id) {
                        userPhotosObject[user_id].photos[i].paid = !userPhotosObject[user_id].photos[i].paid;
                        console.log('changed image payable status')
                        return;
                    }
                }
        }
        else if (type == 'video') {
            if (userVideosObject[user_id] && userVideosObject[user_id].videos)
                for (i in userVideosObject[user_id].videos) {
                    if (userVideosObject[user_id].videos[i].id == id) {
                        userVideosObject[user_id].videos[i].paid = !userVideosObject[user_id].videos[i].paid;
                        console.log('changed video payable status')
                        return;
                    }
                }
        }
    }

    function getUserPhotos(user_id, resolve, reject) {
        console.log('getUserPhotos ' + user_id);
        userPhotosObject[user_id] = userPhotosObject[user_id] ? userPhotosObject[user_id] : {};

        /*-------------new version---------------*/

        var _q = "select json_agg(row_to_json(q.*)) from (SELECT * from admin.doc_file where uid_upload='" + user_id + "' \
			and not mail and not passport and not type = any (array[1,2,3,4]) and format = any (array['jpeg','gif','png','jpg']) order by date desc  )q";
        console.log(_q);

        client.query(_q, function (err) {
            if (err) {
                console.log('Error in File Server p80');
                console.log(err);
                //client.end();
                delete userPhotosObject[user_id]._modifying
                reject()
            }
        })
            .on('row', function (row) {//only one
                //client.end()//extra protection
                //flag _modifyingity and send!
                userPhotosObject[user_id] = userPhotosObject[user_id] ? userPhotosObject[user_id] : {};
                userPhotosObject[user_id].amount = row.json_agg ? row.json_agg.length : 0;
                /*------new version-----*/
                //userPhotosObject[user_id]._modifying=true;
                userPhotosObject[user_id].photos = row.json_agg;
                console.log('userPhotosObject');

                delete userPhotosObject[user_id]._modifying;
                resolve();

                //console.log(userPhotosObject[user_id]);

            })
            .on('end', function () {
                //client.end()
                delete userPhotosObject[user_id]._modifying;
                resolve()
            })
    }

    function getUserVideos(user_id, resolve, reject) {
        console.log('getUserVideos fucntion ', user_id);
        var _q = "select json_agg(row_to_json(q.*)) from (SELECT *,(select price_per_unit from public.finance_service_type where service_type='15') as vid_cost from admin.doc_file where uid_upload='" + user_id + "' \
				and format = any (array['avi','mp4','wmp','flash'])   order by date desc)q";//and not mail  рівносильно до умови відсутності формату webm

        console.log(_q)

        client.query(_q, function (err) {
            if (err) {
                console.log('Error in File Server p80');
                console.log(err);
                //client.end();

                delete userVideosObject[user_id]._modifying;
                reject();
            }
        })
            .on('row', function (row) {//only one
                userVideosObject[user_id] = userVideosObject[user_id] ? userVideosObject[user_id] : {};
                userVideosObject[user_id].amount = row.json_agg ? row.json_agg.length : 0;
                userVideosObject[user_id].videos = row.json_agg;
            })
            .on('end', function () {
                //client.end()
                delete userVideosObject[user_id]._modifying;
                resolve()

            })
    }

    function returnTokens(data) {
        console.log('fucntion returnTokens')
        var user_id = data.user_id;
        var room = data.room;
        var tokens = data.tokens;
        var woman_id = data.woman_id;

        var _q = "INSERT INTO public.user_credit(\
						men_id, women_id, credit, credit_type, service_type,count)\
				VALUES ('" + user_id + "','" + woman_id + "','" + tokens + "','5','3','" + tokens + "')";

        console.log(_q)

        client.query(_q, function (err, result) {
            if (err) {
                console.log('error during query p3451');
                console.log(err);
            }
        })
            .on('end', function () {
                //client.end()
            })
    }

    function getChatRate() {
        var _q = 'select row_to_json(q) from (select * from public.finance_service_type)q'
        var query = client.query(_q);

        query.on('row', (row) => {
            fullRateType = row;
            for (var i in row) {
                rateChatType[row[i].service_type] = row[i].price_per_unit;
            }

        })
            .on('error', (err) => {
                console.log('helenaServer.js p1322')
                console.log(err)
            })
    }

    function getPaidFiles() {
        var _q = 'select json_agg(row_to_json(q)) as result from (select id::text, file_id::text, user_paid::text from public.user_paid_file)q'
        var query = client.query(_q);

        query.on('error', (err) => {
            console.log('helena server position p1320');
            console.log(err);
            return;
        });

        query.on('row', (row) => {
            var result = row.result;
            //console.log(row)
            for (var i in result) {
                var _res = result[i]
                var user_paid = _res.user_paid
                var file_id = _res.file_id;
                paidFiles[user_paid] = paidFiles[user_paid] ? paidFiles[user_paid] : [];
                paidFiles[user_paid].push(file_id);
            }
            //console.log(paidFiles);
        });

        query.on('end', () => {
        });
    }

    function sendMail_notif(obj) {
        let email_text  = app.HandlebarsBase.compile(obj.mail_template)(obj)
        require(app.dir + '/include/mailer.js')({
            from: 'support@softpro.ua',
            subject: obj.subject,
            html: email_text,
            to: obj.user_email
        });
    }


}