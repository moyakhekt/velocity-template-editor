const http = require('http');

const data = JSON.stringify({
    template: 'Hello $name',
    variables: { name: 'World' },
    methods: {}
});

const options = {
    hostname: 'localhost',
    port: 9876,
    path: '/render',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

console.log('Testing connection to Velocity server...');
console.log('Sending:', data);

const req = http.request(options, (res) => {
    console.log('Response status:', res.statusCode);
    console.log('Response headers:', res.headers);
    
    let body = '';
    
    res.on('data', (chunk) => {
        console.log('Received chunk:', chunk.length, 'bytes');
        body += chunk;
    });
    
    res.on('end', () => {
        console.log('Response complete');
        console.log('Body:', body);
    });
    
    res.on('error', (e) => {
        console.error('Response error:', e.message);
    });
});

req.on('error', (e) => {
    console.error('Request error:', e.message, e.code);
});

req.on('socket', (socket) => {
    console.log('Socket attached');
    
    socket.on('connect', () => {
        console.log('Socket connected');
    });
    
    socket.on('close', () => {
        console.log('Socket closed');
    });
    
    socket.on('error', (e) => {
        console.error('Socket error:', e.message);
    });
    
    socket.on('timeout', () => {
        console.error('Socket timeout');
    });
});

req.write(data);
req.end();
console.log('Request sent');
