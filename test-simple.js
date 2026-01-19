const http = require('http');

const data = JSON.stringify({
    template: 'Hello $name',
    variables: { name: 'World' },
    methods: {}
});

const req = http.request({
    hostname: 'localhost',
    port: 9876,
    path: '/render',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Result:', body);
    });
});

req.on('error', e => console.error('Error:', e.message));
req.write(data);
req.end();
