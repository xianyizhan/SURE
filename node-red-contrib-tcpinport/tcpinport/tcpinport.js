module.exports = function(RED) {
    "use strict";
    var reconnectTime = RED.settings.socketReconnectTime||10000;
    var socketTimeout = RED.settings.socketTimeout||null;
    var net = require('net');

    var connectionPool = {};

    function TcpInPort(n){
    	RED.nodes.createNode(this,n);
        this.host = n.host;
        this.port = Number(n.port);
        this.topic = n.topic;
        this.stream = (!n.datamode||n.datamode=='stream'); /* stream,single*/
        this.datatype = n.datatype||'buffer'; /* buffer,utf8,base64 */
        this.newline = (n.newline||"").replace("\\n","\n").replace("\\r","\r");
        this.base64 = n.base64;
        this.server = (typeof n.server == 'boolean')?n.server:(n.server == "server");
        this.closing = false;
        this.connected = false;


    	var node = this;
        var count = 0;
        var vport = 0;

        if (!node.server) {

            this.on("input", function(msg) {

                if ((!Buffer.isBuffer(msg.payload)) && (typeof msg.payload !== "string")) {
                    msg.payload = msg.payload.toString();
                }

                vport = node.port || msg.port;

            
                var buffer = null;
                var client;
                var reconnectTimeout;
                var end = false;
                var setupTcpClient = function() {
                    node.log(RED._("tcpin.status.connecting",{host:node.host,port:vport}));
                    node.status({fill:"grey",shape:"dot",text:"common.status.connecting"});
                    var id = (1+Math.random()*4294967295).toString(16);
                    client = net.connect(vport, node.host, function() {
                        buffer = (node.datatype == 'buffer') ? Buffer.alloc(0) : "";
                        node.connected = true;
                        node.log(RED._("tcpin.status.connected",{host:node.host,port:vport}));
                        node.status({fill:"green",shape:"dot",text:"common.status.connected"});
                    });
                    client.setKeepAlive(true,120000);
                    connectionPool[id] = client;

                    client.on('data', function (data) {
                        if (node.datatype != 'buffer') {
                            data = data.toString(node.datatype);
                        }

                        if (node.stream) {
                        
                            if ((node.datatype) === "utf8" && node.newline !== "") {
                                buffer = buffer+data;
                                var parts = buffer.split(node.newline);
                                for (var i = 0; i<parts.length-1; i+=1) {
                                    msg = {topic:node.topic, payload:parts[i]};
                                    msg._session = {type:"tcp",id:id};
                                    node.send(msg);
                                }
                                buffer = parts[parts.length-1];
                            } else {
                                msg = {topic:node.topic, payload:data};
                                msg._session = {type:"tcp",id:id};
                                node.send(msg);
                            }
                        } else {
                            if ((typeof data) === "string") {
                                buffer = buffer+data;
                            } else {
                                buffer = Buffer.concat([buffer,data],buffer.length+data.length);
                            }
                        }
                        
                    });

                    client.on('end', function() {
                        if (!node.stream || (node.datatype == "utf8" && node.newline !== "" && buffer.length > 0)) {
                            msg = {topic:node.topic, payload:buffer};
                            msg._session = {type:"tcp",id:id};
                            if (buffer.length !== 0) {
                                end = true; // only ask for fast re-connect if we actually got something
                                node.send(msg);
                            }
                            buffer = null;
                        }
                    });

                    client.on('close', function() {
                        delete connectionPool[id];
                        node.connected = false;
                        node.status({fill:"red",shape:"ring",text:"common.status.disconnected"});
                        if (!node.closing) {
                            if (end) { // if we were asked to close then try to reconnect once very quick.
                                end = false;
                                reconnectTimeout = setTimeout(setupTcpClient, 20);
                            }
                            else {
                                node.log(RED._("tcpin.errors.connection-lost",{host:node.host,port:vport}));
                                reconnectTimeout = setTimeout(setupTcpClient, reconnectTime);
                            }
                        } else {
                            if (node.done) { node.done(); }
                        }
                    });
                    client.on('error', function(err) {
                        node.log(err);
                    });
                }

                setupTcpClient();

                this.on('close', function(done) {
                    node.done = done;
                    this.closing = true;
                    if (client) { client.destroy(); }
                    clearTimeout(reconnectTimeout);
                    if (!node.connected) { done(); }
                });
            }
        }
        else{
            var server = net.createServer(function (socket) {
                socket.setKeepAlive(true,120000);
                if (socketTimeout !== null) { socket.setTimeout(socketTimeout); }
                var id = (1+Math.random()*4294967295).toString(16);
                var fromi;
                var fromp;
                connectionPool[id] = socket;
                count++;
                node.status({text:RED._("tcpin.status.connections",{count:count})});

                var buffer = (node.datatype == 'buffer') ? Buffer.alloc(0) : "";
                socket.on('data', function (data) {
                    if (node.datatype != 'buffer') {
                        data = data.toString(node.datatype);
                    }
                    if (node.stream) {
                        var msg;
                        if ((typeof data) === "string" && node.newline !== "") {
                            buffer = buffer+data;
                            var parts = buffer.split(node.newline);
                            for (var i = 0; i<parts.length-1; i+=1) {
                                msg = {topic:node.topic, payload:parts[i], ip:socket.remoteAddress, port:socket.remotePort};
                                msg._session = {type:"tcp",id:id};
                                node.send(msg);
                            }
                            buffer = parts[parts.length-1];
                        } else {
                            msg = {topic:node.topic, payload:data, ip:socket.remoteAddress, port:socket.remotePort};
                            msg._session = {type:"tcp",id:id};
                            node.send(msg);
                        }
                    }
                    else {
                        if ((typeof data) === "string") {
                            buffer = buffer+data;
                        } else {
                            buffer = Buffer.concat([buffer,data],buffer.length+data.length);
                        }
                        fromi = socket.remoteAddress;
                        fromp = socket.remotePort;
                    }
                });
                socket.on('end', function() {
                    if (!node.stream || (node.datatype === "utf8" && node.newline !== "")) {
                        if (buffer.length > 0) {
                            var msg = {topic:node.topic, payload:buffer, ip:fromi, port:fromp};
                            msg._session = {type:"tcp",id:id};
                            node.send(msg);
                        }
                        buffer = null;
                    }
                });
                socket.on('timeout', function() {
                    node.log(RED._("tcpin.errors.timeout",{port:vport}));
                    socket.end();
                });
                socket.on('close', function() {
                    delete connectionPool[id];
                    count--;
                    node.status({text:RED._("tcpin.status.connections",{count:count})});
                });
                socket.on('error',function(err) {
                    node.log(err);
                });
            });

            server.on('error', function(err) {
                if (err) {
                    node.error(RED._("tcpin.errors.cannot-listen",{port:vport,error:err.toString()}));
                }
            });

            server.listen(vport, function(err) {
                if (err) {
                    node.error(RED._("tcpin.errors.cannot-listen",{port:vport,error:err.toString()}));
                } else {
                    node.log(RED._("tcpin.status.listening-port",{port:vport}));
                    node.on('close', function() {
                        for (var c in connectionPool) {
                            if (connectionPool.hasOwnProperty(c)) {
                                connectionPool[c].end();
                                connectionPool[c].unref();
                            }
                        }
                        node.closing = true;
                        server.close();
                        node.log(RED._("tcpin.status.stopped-listening",{port:vport}));
                    });
                }
            });
        }

        
    }   
    RED.nodes.registerType("tcpinport",TcpInPort);
}

