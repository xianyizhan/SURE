 function TcpGet(n) {
        RED.nodes.createNode(this,n);
        this.server = n.server;
        this.port = Number(n.port);
        this.out = n.out;
        this.splitc = n.splitc;

        if (this.out === "immed") { this.splitc = -1; this.out = "time"; }
        if (this.out !== "char") { this.splitc = Number(this.splitc); }
        else {
            if (this.splitc[0] == '\\') {
                this.splitc = parseInt(this.splitc.replace("\\n",0x0A).replace("\\r",0x0D).replace("\\t",0x09).replace("\\e",0x1B).replace("\\f",0x0C).replace("\\0",0x00));
            } // jshint ignore:line
            if (typeof this.splitc == "string") {
                if (this.splitc.substr(0,2) == "0x") {
                    this.splitc = parseInt(this.splitc);
                }
                else {
                    this.splitc = this.splitc.charCodeAt(0);
                }
            } // jshint ignore:line
        }

        var node = this;

        var clients = {};

        this.on("input", function(msg) {
            var i = 0;
            if ((!Buffer.isBuffer(msg.payload)) && (typeof msg.payload !== "string")) {
                msg.payload = msg.payload.toString();
            }

            var host = node.server || msg.host;
            var port = node.port || msg.port;

            // Store client information independently
            // the clients object will have:
            // clients[id].client, clients[id].msg, clients[id].timeout
            var connection_id = host + ":" + port;
            clients[connection_id] = clients[connection_id] || {};
            clients[connection_id].msg = msg;
            clients[connection_id].connected = clients[connection_id].connected || false;

            if (!clients[connection_id].connected) {
                var buf;
                if (this.out == "count") {
                    if (this.splitc === 0) { buf = Buffer.alloc(1); }
                    else { buf = Buffer.alloc(this.splitc); }
                }
                else { buf = Buffer.alloc(65536); } // set it to 64k... hopefully big enough for most TCP packets.... but only hopefully

                clients[connection_id].client = net.Socket();
                if (socketTimeout !== null) { clients[connection_id].client.setTimeout(socketTimeout);}

                if (host && port) {
                    clients[connection_id].client.connect(port, host, function() {
                        //node.log(RED._("tcpin.errors.client-connected"));
                        node.status({fill:"green",shape:"dot",text:"common.status.connected"});
                        if (clients[connection_id] && clients[connection_id].client) {
                            clients[connection_id].connected = true;
                            clients[connection_id].client.write(clients[connection_id].msg.payload);
                            if (node.out === "time" && node.splitc < 0) {
                                clients[connection_id].connected = false;
                                clients[connection_id].client.end();
                                delete clients[connection_id];
                                node.status({});
                            }
                        }
                    });
                }
                else {
                    node.warn(RED._("tcpin.errors.no-host"));
                }

                clients[connection_id].client.on('data', function(data) {
                    if (node.out === "sit") { // if we are staying connected just send the buffer
                        if (clients[connection_id]) {
                            if (!clients[connection_id].hasOwnProperty("msg")) { clients[connection_id].msg = {}; }
                            clients[connection_id].msg.payload = data;
                            node.send(RED.util.cloneMessage(clients[connection_id].msg));
                        }
                    }
                    // else if (node.splitc === 0) {
                    //     clients[connection_id].msg.payload = data;
                    //     node.send(clients[connection_id].msg);
                    // }
                    else {
                        for (var j = 0; j < data.length; j++ ) {
                            if (node.out === "time") {
                                if (clients[connection_id]) {
                                    // do the timer thing
                                    if (clients[connection_id].timeout) {
                                        i += 1;
                                        buf[i] = data[j];
                                    }
                                    else {
                                        clients[connection_id].timeout = setTimeout(function () {
                                            if (clients[connection_id]) {
                                                clients[connection_id].timeout = null;
                                                clients[connection_id].msg.payload = Buffer.alloc(i+1);
                                                buf.copy(clients[connection_id].msg.payload,0,0,i+1);
                                                node.send(clients[connection_id].msg);
                                                if (clients[connection_id].client) {
                                                    node.status({});
                                                    clients[connection_id].client.destroy();
                                                    delete clients[connection_id];
                                                }
                                            }
                                        }, node.splitc);
                                        i = 0;
                                        buf[0] = data[j];
                                    }
                                }
                            }
                            // count bytes into a buffer...
                            else if (node.out == "count") {
                                buf[i] = data[j];
                                i += 1;
                                if ( i >= node.splitc) {
                                    if (clients[connection_id]) {
                                        clients[connection_id].msg.payload = Buffer.alloc(i);
                                        buf.copy(clients[connection_id].msg.payload,0,0,i);
                                        node.send(clients[connection_id].msg);
                                        if (clients[connection_id].client) {
                                            node.status({});
                                            clients[connection_id].client.destroy();
                                            delete clients[connection_id];
                                        }
                                        i = 0;
                                    }
                                }
                            }
                            // look for a char
                            else {
                                buf[i] = data[j];
                                i += 1;
                                if (data[j] == node.splitc) {
                                    if (clients[connection_id]) {
                                        clients[connection_id].msg.payload = Buffer.alloc(i);
                                        buf.copy(clients[connection_id].msg.payload,0,0,i);
                                        node.send(clients[connection_id].msg);
                                        if (clients[connection_id].client) {
                                            node.status({});
                                            clients[connection_id].client.destroy();
                                            delete clients[connection_id];
                                        }
                                        i = 0;
                                    }
                                }
                            }
                        }
                    }
                });

                clients[connection_id].client.on('end', function() {
                    //console.log("END");
                    node.status({fill:"grey",shape:"ring",text:"common.status.disconnected"});
                    if (clients[connection_id] && clients[connection_id].client) {
                        clients[connection_id].connected = false;
                        clients[connection_id].client = null;
                    }
                });

                clients[connection_id].client.on('close', function() {
                    //console.log("CLOSE");
                    if (clients[connection_id]) {
                        clients[connection_id].connected = false;
                    }

                    var anyConnected = false;

                    for (var client in clients) {
                        if (clients[client].connected) {
                            anyConnected = true;
                            break;
                        }
                    }
                    if (node.done && !anyConnected) {
                        clients = {};
                        node.done();
                    }
                });

                clients[connection_id].client.on('error', function() {
                    //console.log("ERROR");
                    node.status({fill:"red",shape:"ring",text:"common.status.error"});
                    node.error(RED._("tcpin.errors.connect-fail") + " " + connection_id, msg);
                    if (clients[connection_id] && clients[connection_id].client) {
                        clients[connection_id].client.destroy();
                        delete clients[connection_id];
                    }
                });

                clients[connection_id].client.on('timeout',function() {
                    //console.log("TIMEOUT");
                    if (clients[connection_id]) {
                        clients[connection_id].connected = false;
                        node.status({fill:"grey",shape:"dot",text:"tcpin.errors.connect-timeout"});
                        //node.warn(RED._("tcpin.errors.connect-timeout"));
                        if (clients[connection_id].client) {
                            clients[connection_id].client.connect(port, host, function() {
                                clients[connection_id].connected = true;
                                node.status({fill:"green",shape:"dot",text:"common.status.connected"});
                            });
                        }
                    }
                });
            }
            else {
                if (clients[connection_id] && clients[connection_id].client) {
                    clients[connection_id].client.write(clients[connection_id].msg.payload);
                }
            }
        });

        this.on("close", function(done) {
            node.done = done;
            for (var cl in clients) {
                if (clients[cl].hasOwnProperty("client")) {
                    clients[cl].client.destroy();
                }
            }
            node.status({});

            // this is probably not necessary and may be removed
            var anyConnected = false;
            for (var c in clients) {
                if (clients[c].connected) {
                    anyConnected = true;
                    break;
                }
            }
            if (!anyConnected) { clients = {}; }
            done();
        });

    }
    RED.nodes.registerType("tcp request",TcpGet);
