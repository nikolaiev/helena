var server;
var io;
var config;
var cookieParser = require('cookie-parser')();
var session = require('cookie-session')({ secret: 'securedsession' });
var users = {};

module.exports = function(app) {
	console.log('========================START==============================');
    //app.use(session)
    config = app.config;
    var PORT = app.config.online_checker_port;
    // server = require('https').createServer(app.secureOptions, app);
    // server.listen(PORT, function() {
    //     console.log(' online status checker server listening at ' + PORT);
    //
    // });

    io = require('socket.io').listen(PORT, {  //changed server to PORT
        transports: ['xhr-polling', 'websocket', 'polling']
    });

    io.use(function(socket, next) {
        var req = socket.handshake;
        var res = {};
        cookieParser(req, res, function(err) {
            if (err) return next(err);
            session(req, res, next);
        });
    });
    console.log({PORT})

    io.sockets.on('connection', function(socket) {

        console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++'+PORT)
        console.log('++++++++++++++++++--erherherherherher-----------------------------')
        console.log(socket.handshake.session.passport.user.user_id.toString())
        try {
            var user_id = socket.handshake.session.passport.user.user_id.toString();

            var sex = socket.handshake.session.passport.user.sex.toString();
            var user_name = socket.handshake.session.passport.user.firstname.toString();
        } catch (e) {
            console.log('ERROR userInfoServer! p 40 ');
            console.log(e)
        } finally {
            console.log('ONLINE connection ' + user_id);
            console.log(user_id);
            if (typeof(user_id) != 'undefined')
                socket.join(user_id);
        }

        if (!users[user_id])
            users[user_id] = {};

        if (users[user_id]._modifying) {
            users[user_id]._modifying.then(function() {
                users[user_id]._modifying = new Promise(function(resolve, reject) {
                    if (!users[user_id].amount)
                        users[user_id].amount = 1;
                    else
                        ++users[user_id].amount;
                    delete users[user_id]._modifying;
                    resolve();
                    // console.log('onlineUserServer')
                    // console.log(users)
                });
            })
        } else {
            users[user_id]._modifying = new Promise(function(resolve, reject) {
                if (!users[user_id].amount)
                    users[user_id].amount = 1;
                else
                    ++users[user_id].amount;
                delete users[user_id]._modifying;
                resolve();
            });
        }

        //users_online[user_id]=users[user_id]>0?true:false;

        socket.on('error', function(err) {
            console.log('onlineStatusChecker server socket error ', err);
        });

        socket.on('disconnect', function() {
            if (users[user_id]._modifying) {
                users[user_id]._modifying.then(function() {
                    users[user_id]._modifying = new Promise(function(resolve, reject) {

                        --users[user_id].amount;
                        if (users[user_id].amount < 0)
                            console.log('THIS APPROACH IS VERY BAD!!!!');
                        delete users[user_id]._modifying;
                        resolve();
                        // console.log('onlineUserServer')
                        // console.log(users)
                    });
                })
            } else {
                users[user_id]._modifying = new Promise(function(resolve, reject) {
                    --users[user_id].amount;
                    if (users[user_id].amount < 0)
                        console.log('THIS APPROACH IS VERY BAD!!!! userInfoServer p100');
                    delete users[user_id]._modifying;
                    resolve();
                    // console.log('onlineUserServer')
                    // console.log(users)
                });
            }
        });
    });

    /*-------extra routes-----*/
    app.post('/user_online_status/', function(req, res) {
        var uid = req.body.id; //desired_id
        //console.log('/users_online_status/');

        var result = users[uid] && users[uid].amount > 0 ? true : false;
        console.log(result);
        res.send({ 'status': result, 'uid': uid.toString() });
    });


    /*app.post('/users_list_rand/',function(req,res){
    	var user_sex=req.session.passport.user.sex;
    	var template=req.body.template;
    	
    	app.getDB(req,res,function(db,req){
    		//çàïðîñ íà øàáëîí!
    		var _q="select body->>'body' as data from admin.doc_template where title='"+template+"'";
    		app.pg_request({'conString':db.conString,'res':res,'req':req,'app':app},_q,function(err,template,res){
    			if(err){
    				res.status=500;
    				res.json({'result':'error'});
    				return;			
    			}
    			var _users=getUsersOnline();

    			var _q="select json_agg(row_to_json(q)) as rows from (SELECT * from public.user_view where sex<>'"+user_sex+"' and user_id = any ('{"+_users.join(',')+"}'::bigint[])\
    				order by random() limit'"+req.body.limit+"')q ";

    			app.pg_request({'conString':db.conString,'res':res,'req':req,'app':app},_q,function(err,users,res){
    				if(err){
    					res.status=500;
    					res.json({'result':'error'});
    					return;			
    				}
    				var _template=template.data;
    				res.send({'data':app.HandlebarsBase.compile(_template||'')(users)});
    			});
    		});
    	})
    });*/

    /**post partners route for chat windows*/
    app.post('/users_list_chat/', function(req, res) {

        var user_sex = req.session.passport.user.sex;
        var template = req.body.template;
        //TODO use it!
        //var web_cam_on=req.body.webcam;//видеочат или текстовый чат
        console.log('/users_list_chat/');
        //console.log(req.body);

        var user_to_skip = JSON.parse(req.body['skip']) || [];
        console.log('users_to_skip')
        console.log(user_to_skip)

        app.getDB(req, res, function(db, req) {

            var _users = getUsersOnline();
            var q_arr = [];
            q_arr.push({ "id": "template", "query": "select body->>'body' as template from admin.doc_template where title='" + template + "'" });

            //если ищет девушка - проверка состояния камеры не нужна
            q_arr.push({
                "id": "users",
                "query": "select json_agg(row_to_json(q)) as rows from (SELECT * from public.user_view " +
                    "where sex<>'" + user_sex + "'  and user_id = any ('{" + _users.join(',') + "}'::bigint[]) " +
                    "and not(user_id = any ('{" + user_to_skip.join(',') + "}'::bigint[]))" +
                    (user_sex == '1' ? (req.body.webcam == 'true' ? "and web_camera_status='2'" : " ") : "") +
                    " limit'" + req.body.limit + "' offset '" + req.body.offset + "')q "
            });

            q_arr.push({
                "id": "count",
                "query": "SELECT count(*) from public.user_view " +
                    "where sex<>'" + user_sex + "' and user_id = any ('{" + _users.join(',') + "}'::bigint[])" +
                    "and not(user_id = any ('{" + user_to_skip.join(',') + "}'::bigint[]))" +
                    (user_sex == '1' ? (req.body.webcam == 'true' ? "and web_camera_status='2'" : " ") : "") +
                    " limit'" + req.body.limit + "' offset '" + req.body.offset + "' "
            });

            //console.log(q_arr)

            app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, q_arr, function(err, result, res) {
                if (err) {
                    res.status = 500;
                    res.json({ 'result': 'error' });
                    return;
                }
                var data = {};
                data.count = result.count.count;
                result.users.video_chat = req.body.webcam;
                data.data = app.HandlebarsBase.compile(result.template.template)(result.users);

                res.json(data);
            });
        });
    });

    app.post('/users_list/', function(req, res) {
        //console.log('/users_list/')
        if (!req.session)
            return res.end();
        var user_sex = req.session.passport.user.sex;
        var template = req.body.template;

        app.getDB(req, res, function(db, req) {
            //çàïðîñ íà øàáëîí!

            var user_id = req.session.passport.user.user_id;
            var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
            //console.log(_q)
            app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, template, res) {
                if (err) {
                    res.status = 500;
                    res.json({ 'result': 'error' });
                    return;
                }
                var _users = getUsersOnline();
                //console.log(_users)
                var _q = "select json_agg(row_to_json(q)) as rows from (SELECT '" + user_id + "' as myid, *,favorite_list_id @> '" + user_id + "' as is_favorite,coalesce(ignore_list_id @> '" + user_id + "',\
(select ignore_list_id @> q.user_id::text::jsonb from user_view where  user_id='" + user_id + "' )) as is_ignore,(select dir||file_name from user_avatar_short_view where user_id=q.user_id) as avatar from public.user_view q where sex<>'" + user_sex + "' and user_id = any ('{" + _users.join(',') + "}'::bigint[])\
					limit'" + req.body.amount + "' offset '" + req.body.offset + "')q ";
                //console.log(_q)
                //çàïðîñ ïîëüçîâàòåëåé!
                app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, users, res) {
                    if (err) {
                        res.status = 500;
                        res.json({ 'result': 'error' });
                        return;
                    }
                    var _template = template.data;
                    res.send({ 'data': app.HandlebarsBase.compile(_template || '')(users), 'amount': users.rows ? users.rows.length : 0 });
                });
            });
        });
    });


    /*-----------online for login page--------------*/
    app.post('/get_online_users_login/', function(req, res) {
            var template = req.body.template;
            console.log(template);
            app.getDB(req, res, function(db, req) {
                var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
                //console.log(_q)
                app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, template, res) {
                    if (err) {
                        res.status = 500;
                        res.json({ 'result': 'error' });
                        return;
                    }

                    var _users = getUsersOnline();

                    var _q = "select json_agg(row_to_json(q)) as rows from (\
							(SELECT * from public.user_view where sex='2' and user_id = any ('{" + _users.join(',') + "}'::bigint[]) limit 9)\
								union all\
							(SELECT * from public.user_view where sex='1' and user_id = any ('{" + _users.join(',') + "}'::bigint[]) limit 3)\
						)q ";
                    //console.log(_q)
                    //çàïðîñ ïîëüçîâàòåëåé!
                    app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, users, res) {
                        if (err) {
                            res.status = 500;
                            res.json({ 'result': 'error' });
                            return;
                        }
                        var _template = template.data;
                        res.send({ 'data': app.HandlebarsBase.compile(_template || '')(users) });
                    });
                });
            })
        })
        /*-----------------------ends------------------*/
        /*---popular---*/

    //v2
    app.post('/get_top_users/', function(req, res) {

        var user_id = req.session.passport.user.user_id;
        console.log('/helena/get_top_users/');
        var user_sex = req.session.passport.user.sex;
        var template = req.body.template;
        var _limit = req.body.limit || 25;

        app.getDB(req, res, function(db, req) {
            //çàïðîñ íà øàáëîí!
            var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
            //console.log(_q)
            app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, template, res) {
                if (err) {
                    res.status = 500;
                    res.json({ 'result': 'error' });
                    return;
                }
                var _q = "select json_agg(row_to_json(q)) as rows from (Select '" + user_id + "' as myid, *,favorite_list_id @> '" + user_id + "' as is_favorite,coalesce(ignore_list_id @> '" + user_id + "',\
(select ignore_list_id @> q.user_id::text::jsonb from user_view where  user_id='" + user_id + "' )) as is_ignore from user_popular_month_view q where sex<>'" + user_sex + "'  limit '" + _limit + "')q "
                    //console.log(_q)
                    //çàïðîñ ïîëüçîâàòåëåé!
                app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, users, res) {
                    if (err) {
                        res.status = 500;
                        res.json({ 'result': 'error' });
                        return;
                    }
                    var _template = template.data;
                    res.send({ 'data': app.HandlebarsBase.compile(_template || '')(users), 'amount': users.rows ? users.rows.length : 0 });
                });

            });
        })
    })

    app.post('/get_user_by_id/', function(req, res) {
        console.log('/get_user_by_id/');

        var user_id = req.session.passport.user.user_id;
        var user_sex = req.session.passport.user.sex;
        var template = req.body.template;
        //var _limit=req.body.limit||25;
        var id = req.body.id;
        //console.log(template)


        app.getDB(req, res, function(db, req) {
            //çàïðîñ íà øàáëîí!
            var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
            //console.log(_q)
            app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, template, res) {
                if (err) {
                    res.status = 500;
                    res.json({ 'result': 'error' });
                    return;
                }
                var _q = "select json_agg(row_to_json(q)) as rows from (Select '" + user_id + "' as myid, *,favorite_list_id @> '" + user_id + "' as is_favorite,coalesce(ignore_list_id @> '" + user_id + "',\
(select ignore_list_id @> q.user_id::text::jsonb from user_view where  user_id='" + user_id + "' )) as is_ignore from user_view q where sex<>'" + user_sex + "'  and id_serial= '" + id + "')q "
                    //console.log(_q)
                    //çàïðîñ ïîëüçîâàòåëåé!
                res.template = template;
                app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, users, res) {
                    if (err) {
                        res.status = 500;
                        res.json({ 'result': 'error' });
                        return;
                    }
                    var _template = res.template.data;
                    res.send({ 'data': app.HandlebarsBase.compile(_template || '')(users) });
                });

            });
        })
    });

    app.post('/get_user_by_params/', (req, res) => {
        console.log('/get_user_by_params/');
        var user_sex = req.session.passport.user.sex;
        var template = req.body.template;
        var user_id = req.session.passport.user.user_id;

        var _limit = req.body.limit || 9;
        var _offset = req.body.offset || 0;
        var id = req.body.id;
        var data = req.body;
        console.log(data)

        app.getDB(req, res, function(db, req) {
            //çàïðîñ íà øàáëîí!
            var _q = "select body->>'body' as data from admin.doc_template where title='" + template + "'";
            console.log(_q)
            app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, template, res) {
                if (err) {
                    res.status = 500;
                    res.json({ 'result': 'error' });
                    return;
                }

                //TODO модифицировтаь запрос
                var _q = "select json_agg(row_to_json(q)) as rows from (Select (select dir||file_name from user_avatar_short_view where user_id=q.user_id) as avatar, '" + user_id + "' as myid, \
                    *,\
                    user_id in  (SELECT view_user_id FROM public.user_list where user_id=" + user_id + " and type = 1 and enabled ) as is_favorite, \
    date_part('year'::text, age(now()::date::timestamp with time zone,birthday::timestamp with time zone))::text AS age,\
 user_id in (SELECT view_user_id FROM public.user_list where user_id=" + user_id + " and type = 2 and enabled ) as is_ignore  from user_view q \
 where activation_status=1 and sex not in (" + user_sex + ",3) ";
                console.log('go')
                var _q_amount = "Select count(*) from user_view where activation_status=1 and  sex not in (" + user_sex + ",3) "

                if (id) {
                    _q += " and user_id='" + id + "')q";
                    _q_amount += " and user_id='" + id + "'";
                } else {
                    if (data.hair_color_id && !data.hair_color_id.match(/^\s*$/)) {
                        _q += " and  user_haircolor_id='" + data.hair_color_id + "' ";
                        _q_amount += " and  user_haircolor_id='" + data.hair_color_id + "' ";
                    }

                    if (data.eye_color_id && !data.eye_color_id.match(/^\s*$/)) {
                        _q += " and  user_eyecolor_id='" + data.eye_color_id + "' ";
                        _q_amount += " and  user_eyecolor_id='" + data.eye_color_id + "' ";
                    }

                    if (data.education_id && !data.education_id.match(/^\s*$/)) {
                        _q += " and user_education_id='" + data.education_id + "' ";
                        _q_amount += " and user_education_id='" + data.education_id + "' ";
                    }

                    if (data.marital_id && !data.marital_id.match(/^\s*$/)) {
                        _q += " and user_marital_id='" + data.marital_id + "' ";
                        _q_amount += " and user_marital_id='" + data.marital_id + "' ";
                    }

                    if (data.language_second_id && !data.language_second_id.match(/^\s*$/)) {
                        _q += " and user_second_lang_id='" + data.language_second_id + "' ";
                        _q_amount += " and user_second_lang_id='" + data.language_second_id + "' ";
                    }

                    if (data.smoking_id && !data.smoking_id.match(/^\s*$/)) {
                        _q += " and user_smoking_id='" + data.smoking_id + "' ";
                        _q_amount += " and user_smoking_id='" + data.smoking_id + "' ";
                    }

                    /*if(!data.job.match(/^\s*$/))
                    	_q+=" user_smoking_id='"+data.job+"' ";*/

                    if (data.religion_id && !data.religion_id.match(/^\s*$/)) {
                        _q += " and user_religion_id='" + data.religion_id + "' ";
                        _q_amount += " and user_religion_id='" + data.religion_id + "' ";
                    }

                    /*if(!data.has_children.match(/^\s*$/))
                    	_q+=" user_religion_id='"+data.has_children+"' ";*/

                    if (data.language_english_level_id && !data.language_english_level_id.match(/^\s*$/)) {
                        _q += " and user_english_level_id='" + data.language_english_level_id + "' ";
                        _q_amount += " and user_english_level_id='" + data.language_english_level_id + "' ";
                    }

                    //TODO правильно? 
                    if (data.address_city_id && !data.address_city_id.match(/^\s*$/)) {
                        _q += " and map_country_id='" + data.address_city_id + "' ";
                        _q_amount += " and map_country_id='" + data.address_city_id + "' ";
                    }

                    //2 side bounds!
                    if (data.height_min && !data.height_min.match(/^\s*$/) && !data.height_max.match(/^\s*$/)) {
                        _q += " and height between '" + data.height_min + "' and '" + data.height_max + "' ";
                        _q_amount += " and height between '" + data.height_min + "' and '" + data.height_max + "' ";
                    } else if (data.height_min && !data.height_min.match(/^\s*$/) && data.height_max.match(/^\s*$/)) {
                        _q += " and height>='" + data.height_min + "' ";
                        _q_amount += " and height>='" + data.height_min + "' ";
                    } else if (data.height_max && !data.height_max.match(/^\s*$/)) {
                        _q += " and height<='" + data.height_max + "' ";
                        _q_amount += " and height<='" + data.height_max + "' ";
                    }

                    if (data.weight_min && !data.weight_min.match(/^\s*$/) && !data.weight_max.match(/^\s*$/)) {
                        _q += " and weight between '" + data.weight_min + "' and '" + data.weight_max + "' ";
                        _q_amount += " and weight between '" + data.weight_min + "' and '" + data.weight_max + "' ";
                    } else if (data.weight_min && !data.weight_min.match(/^\s*$/) && data.weight_max.match(/^\s*$/)) {
                        _q += " and weight>='" + data.weight_min + "' ";
                        _q_amount += " and weight>='" + data.weight_min + "' ";
                    } else if (data.weight_max && !data.weight_max.match(/^\s*$/)) {
                        _q_amount += " and weight<='" + data.weight_max + "'";
                    }


                    //2 side bounds!
                    if (data.age_min && !data.age_min.match(/^\s*$/) && !data.age_max.match(/^\s*$/)) {
                        _q += " and age between '" + data.age_min + "' and '" + data.age_max + "' ";
                        _q_amount += " and age between '" + data.age_min + "' and '" + data.age_max + "' ";
                    } else if (data.age_min && !data.age_min.match(/^\s*$/) && data.age_max.match(/^\s*$/)) {
                        _q += " and age>='" + data.age_min + "' ";
                        _q_amount += " and age>='" + data.age_min + "' ";
                    } else if (data.age_max && !data.age_max.match(/^\s*$/)) {
                        _q += " and age<='" + data.age_max + "' ";
                        _q_amount += " and age<='" + data.age_max + "' ";
                    }

                    if (data.is_online == 'true' || data.is_online == true) {
                        _q += " order by user_id offset '" + _offset + "' )q "
                    } else {
                        _q += " order by user_id limit '" + _limit + "' offset '" + _offset + "' )q "
                    }
                }

                console.log(_q)
                console.log(_q_amount)

                res.template = template;
                //запрос на количество!
                app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q_amount, function(err, result, res) {
                    if (err) {
                        res.status = 500;
                        res.json({ 'result': 'error' });
                        return;
                    }
                    res.count = result.count;
                    //выборка данных!
                    app.pg_request({ 'conString': db.conString, 'res': res, 'req': req, 'app': app }, _q, function(err, users_all, res) {
                        if (err) {
                            res.status = 500;
                            res.json({ 'result': 'error' });
                            return;
                        }

                        if (data.is_online == 'true' || data.is_online == true) {
                            var _users_online = {};
                            _users_online.rows = [];
                            for (var i in users_all.rows) {
                                if (_users_online.rows.length == _limit)
                                    break;
                                var uid = users_all.rows[i].user_id;
                                if (users[uid] && users[uid].amount > 0) {
                                    _users_online.rows.push(users_all.rows[i])
                                }
                            }
                            users_all = _users_online;
                            res.count = users_all.rows.length;
                        }

                        var _template = res.template.data;

                        res.send({ 'data': app.HandlebarsBase.compile(_template || '')(users_all), 'count': res.count });
                    });
                });
            });
        })
    });

    /*-------ens---------*/
    function getUsersOnline(webcam) {
        var data = [];
        for (var i in users) {
            if (users[i].amount > 0 && typeof(i) != 'undefined' && i != 'undefined') {
                if (webcam) {

                } else
                    data.push(i);
            }
        }
        return data;
    }
};
