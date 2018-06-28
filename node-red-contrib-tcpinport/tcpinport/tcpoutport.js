module.exports = function(RED) {
    "use strict";
    var reconnectTime = RED.settings.socketReconnectTime||10000;
    var socketTimeout = RED.settings.socketTimeout||null;
    var net = require('net');

    var connectionPool = {};        

        function TcpOutPort(n) {
        RED.nodes.createNode(this,n);
        this.host = n.host;
        this.port = n.port * 1;
        this.base64 = n.base64;
        this.doend = n.end || false;
        this.beserver = n.beserver;
        this.name = n.name;
        this.closing = false;
        this.connected = false;
        var node = this;

        if (!node.beserver||node.beserver=="client") {
            var reconnectTimeout;
            var client = null;
            var end = false;

            var setupTcpClient = function() {
                node.log(RED._("tcpin.status.connecting",{host:node.host,port:node.port}));
                node.status({fill:"grey",shape:"dot",text:"common.status.connecting"});
                client = net.connect(node.port, node.host, function() {
                    node.connected = true;
                    node.log(RED._("tcpin.status.connected",{host:node.host,port:node.port}));
                    node.status({fill:"green",shape:"dot",text:"common.status.connected"});
                });
                client.setKeepAlive(true,120000);
                client.on('error', function (err) {
                    node.log(RED._("tcpin.errors.error",{error:err.toString()}));
                });
                client.on('end', function (err) {
                    node.status({});
                    node.connected = false;
                });
                client.on('close', function() {
                    node.status({fill:"red",shape:"ring",text:"common.status.disconnected"});
                    node.connected = false;
                    client.destroy();
                    if (!node.closing) {
                        if (end) {
                            end = false;
                            reconnectTimeout = setTimeout(setupTcpClient,20);
                        }
                        else {
                            node.log(RED._("tcpin.errors.connection-lost",{host:node.host,port:node.port}));
                            reconnectTimeout = setTimeout(setupTcpClient,reconnectTime);
                        }
                    } else {
                        if (node.done) { node.done(); }
                    }
                });
            }
            setupTcpClient();

            node.on("input", function(msg) {
                if (node.connected && msg.payload != null) {
                    if (Buffer.isBuffer(msg.payload)) {
                        client.write(msg.payload);
                    } else if (typeof msg.payload === "string" && node.base64) {
                        client.write(Buffer.from(msg.payload,'base64'));
                    } else {
                        client.write(Buffer.from(""+msg.payload));
                    }
                    if (node.doend === true) {
                        end = true;
                        if (client) { node.status({}); client.destroy(); }
                    }
                }
            });

            node.on("close", function(done) {
                node.done = done;
                this.closing = true;
                if (client) { client.destroy(); }
                clearTimeout(reconnectTimeout);
                if (!node.connected) { done(); }
            });

        }
        else if (node.beserver == "reply") {
            node.on("input",function(msg) {
                if (msg._session && msg._session.type == "tcp") {
                    var client = connectionPool[msg._session.id];
                    if (client) {
                        if (Buffer.isBuffer(msg.payload)) {
                            client.write(msg.payload);
                        } else if (typeof msg.payload === "string" && node.base64) {
                            client.write(Buffer.from(msg.payload,'base64'));
                        } else {
                            client.write(Buffer.from(""+msg.payload));
                        }
                    }
                }
                else {
                    for (var i in connectionPool) {
                        if (Buffer.isBuffer(msg.payload)) {
                            connectionPool[i].write(msg.payload);
                        } else if (typeof msg.payload === "string" && node.base64) {
                            connectionPool[i].write(Buffer.from(msg.payload,'base64'));
                        } else {
                            connectionPool[i].write(Buffer.from(""+msg.payload));
                        }
                    }
                }
            });
        }
        else {
            var connectedSockets = [];
            node.status({text:RED._("tcpin.status.connections",{count:0})});
            var server = net.createServer(function (socket) {
                socket.setKeepAlive(true,120000);
                if (socketTimeout !== null) { socket.setTimeout(socketTimeout); }
                var remoteDetails = socket.remoteAddress+":"+socket.remotePort;
                node.log(RED._("tcpin.status.connection-from",{host:socket.remoteAddress, port:socket.remotePort}));
                connectedSockets.push(socket);
                node.status({text:RED._("tcpin.status.connections",{count:connectedSockets.length})});
                socket.on('timeout', function() {
                    node.log(RED._("tcpin.errors.timeout",{port:node.port}));
                    socket.end();
                });
                socket.on('close',function() {
                    node.log(RED._("tcpin.status.connection-closed",{host:socket.remoteAddress, port:socket.remotePort}));
                    connectedSockets.splice(connectedSockets.indexOf(socket),1);
                    node.status({text:RED._("tcpin.status.connections",{count:connectedSockets.length})});
                });
                socket.on('error',function() {
                    node.log(RED._("tcpin.errors.socket-error",{host:socket.remoteAddress, port:socket.remotePort}));
                    connectedSockets.splice(connectedSockets.indexOf(socket),1);
                    node.status({text:RED._("tcpin.status.connections",{count:connectedSockets.length})});
                });
            });

            node.on("input", function(msg) {
                if (msg.payload != null) {
                    var buffer;
                    if (Buffer.isBuffer(msg.payload)) {
                        buffer = msg.payload;
                    } else if (typeof msg.payload === "string" && node.base64) {
                        buffer = Buffer.from(msg.payload,'base64');
                    } else {
                        buffer = Buffer.from(""+msg.payload);
                    }
                    for (var i = 0; i < connectedSockets.length; i += 1) {
                        if (node.doend === true) { connectedSockets[i].end(buffer); }
                        else { connectedSockets[i].write(buffer); }
                    }
                }
            });

            server.on('error', function(err) {
                if (err) {
                    node.error(RED._("tcpin.errors.cannot-listen",{port:node.port,error:err.toString()}));
                }
            });

            server.listen(node.port, function(err) {
                if (err) {
                    node.error(RED._("tcpin.errors.cannot-listen",{port:node.port,error:err.toString()}));
                } else {
                    node.log(RED._("tcpin.status.listening-port",{port:node.port}));
                    node.on('close', function() {
                        for (var c in connectedSockets) {
                            if (connectedSockets.hasOwnProperty(c)) {
                                connectedSockets[c].end();
                                connectedSockets[c].unref();
                            }
                        }
                        server.close();
                        node.log(RED._("tcpin.status.stopped-listening",{port:node.port}));
                    });
                }
            });
        }
    }
    RED.nodes.registerType("tcpoutport",TcpOutPort);
}