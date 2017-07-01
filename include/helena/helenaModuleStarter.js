const TOKENS_CHECK_PERIOD=1500;
const user_tokens = {};
const share_obj = {};
let conString;
let client;
const pg = require('pg');
let io;
const session = require('cookie-session')({secret: 'securedsession'});
const cookieParser = require('cookie-parser')();

const log=require("./collor-logger");
module.exports=function(app){
	
	const parsedJSON = require(app.dir + '/config/configServer.json');
	const helenConfig = parsedJSON.helena_server;
	const PORT=helenConfig.server.portHTTPS;
	//const PORT=helenConfig.server.portHTTP;
	
	
	server = require('https').createServer(app.secureOptions, app);
	
	io = require('socket.io').listen(server);
	io.set("transports", ["xhr-polling","polling",'websocket']); 

	//шарим сокетам данные пасспорта
	io.use(function(socket, next) {
		const req = socket.handshake;
		const res = {};
		cookieParser(req, res, function(err) {
			if (err) return next(err);
			session(req, res, next);
		});
	});
	
	//запускаем сервер
	server.listen(PORT,function(){
		log.info('dates admin server listening at '+PORT);
	});
	
	//=========WORK WITH ADMIN SOCKETS
	io.sockets.on('connection', function(socket) {
		console.log('helena admin socket is connected!');
		socket.join('global_room');
	});

	
	share_obj.app=app;
	share_obj.user_tokens=user_tokens;
	
	//================CHAT SERVER===========================
	//require(__dirname+'/../helena/chatServerHTTPS.js')(share_obj);

	//================VIDEO SERVER===========================
	require('./videoWebRtcSignaling-Server.js')(app);
	//require('./videoWebRTCServerHTTPS_old')(app);

	//================MAIL SERVER==========
	require('./helenaAdditionalRoutes.js')(share_obj);


	//=================HELENA ONLINE SERVER!
	
	//console.log('-----------------------------------')
	//require(__dirname+'/../helena/userInfoServer.js')(app);
	
	share_obj.admin_sockets=io;
	//================DATES SERVER==========================

	require('./datesServerHTTPS.js')(share_obj);
	
	
	
	conString='pg://'+helenConfig.dataBase.admin+':'+helenConfig.dataBase.pass+'@'+helenConfig.dataBase.host+':'+helenConfig.dataBase.port+'/'+helenConfig.dataBase.dbname;
	client= new pg.Client(conString);
	client.connect();
	
	monitorUsersTokens();
	setInterval(monitorUsersTokens,TOKENS_CHECK_PERIOD);


	function monitorUsersTokens(){
		user_tokens.actual=new Promise((resolve,reject)=>{
			let _q="select json_agg(row_to_json(q.*)) from (select user_id::text,balance from public.user_balance_short_view)q";
			if(!client){
				client=new pg.Client(conString);
				client.connect();
			}
			
			client.query(_q)
			.on('row',function(row){
				try{
					row=row.json_agg;
					for(var i in row){							
						user_tokens[row[i].user_id]=row[i].balance;						
					}
				}
				catch(e){
					delete user_tokens.actual;
					resolve();
				}
			})
			.on('error',function(err){
				console.log("newHelenaServer.js "+err);
				delete user_tokens.actual;
				resolve();
				
			})
			.on('end',function(){
				delete user_tokens.actual;
				resolve();
			});
		});	
	}
};

