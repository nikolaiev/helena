/*Text effects*/
Reset = "\x1b[0m";
Bright = "\x1b[1m";
Dim = "\x1b[2m";
Underscore = "\x1b[4m";
Blink = "\x1b[5m";
Reverse = "\x1b[7m";
Hidden = "\x1b[8m";

/*Font colors*/
FgBlack = "\x1b[30m";
FgRed = "\x1b[31m";
FgGreen = "\x1b[32m";
FgYellow = "\x1b[33m";
FgBlue = "\x1b[34m";
FgMagenta = "\x1b[35m";
FgCyan = "\x1b[36m";
FgWhite = "\x1b[37m";

/*Background colors*/
BgBlack = "\x1b[40m";
BgRed = "\x1b[41m";
BgGreen = "\x1b[42m";
BgYellow = "\x1b[43m";
BgBlue = "\x1b[44m";
BgMagenta = "\x1b[45m";
BgCyan = "\x1b[46m";
BgWhite = "\x1b[47m";

module.exports=(()=>{
    return {
        info:(data)=>{
            let fileAndLine = traceCaller(1);
            console.log('\x1b[32m%s %s \x1b[36m%s\x1b[0m',fileAndLine,"[INFO]", data);
        },
        warn:(data)=>{
            let fileAndLine = traceCaller(1);
            console.log('\x1b[33m%s %s \x1b[36m%s\x1b[0m',fileAndLine,"[WARN]", data);
        },
        error:(data)=>{
            let fileAndLine = traceCaller(1);
            console.log('\x1b[31m%s %s \x1b[36m%s\x1b[0m',fileAndLine,"[ERROR]", data);
        }
    }
})();


/**
 * Examines the call stack and returns a string indicating
 * the file and line number of the n'th previous ancestor call.
 * this works in chrome, and should work in nodejs as well.
 *
 * @param n : int (default: n=1) - the number of calls to trace up the
 *   stack from the current call.  `n=0` gives you your current file/line.
 *  `n=1` gives the file/line that called you.
 *
 *  @link https://stackoverflow.com/questions/13410754/i-want-to-display-the-file-name-in-the-log-statement?rq=1
 */
function traceCaller(n) {
    if( isNaN(n) || n<0) n=1;
    n+=1;
    let s = (new Error()).stack
        , a=s.indexOf('\n',5);
    while(n--) {
        a=s.indexOf('\n',a+1);
        if( a<0 ) { a=s.lastIndexOf('\n',s.length); break;}
    }
    b=s.indexOf('\n',a+1); if( b<0 ) b=s.length;
    a=Math.max(s.lastIndexOf(' ',b), s.lastIndexOf('/',b));
    b=s.lastIndexOf(':',b);
    s=s.substring(a+1,b);
    return s;
}