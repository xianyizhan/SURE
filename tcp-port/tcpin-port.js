module.exports = function(RED) {
    "use strict";
    var reconnectTime = RED.settings.socketReconnectTime||10000;
    var socketTimeout = RED.settings.socketTimeout||null;
    var net = require('net');

    var connectionPool = {};

    function TcpInPort(n){
    	RED.nodes.createNode(this,n);
    	


    	var node = this;
    }
}