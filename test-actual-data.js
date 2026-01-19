const http = require('http');
const fs = require('fs');
const path = require('path');

const varsPath = path.join(__dirname, 'example.vars.json');
const mocksPath = path.join(__dirname, 'example.mocks.json');

const variables = JSON.parse(fs.readFileSync(varsPath, 'utf8'));
const mocksRaw = JSON.parse(fs.readFileSync(mocksPath, 'utf8'));

// Convert mocks to expected format
const mocks = {};
for (const className in mocksRaw) {
    mocks[className] = {};
    for (const methodName in mocksRaw[className]) {
        mocks[className][methodName] = {
            name: mocksRaw[className][methodName].name,
            implementation: mocksRaw[className][methodName].implementation
        };
    }
}

const template = 'Test: $user.name - $user.getEmail()';

const postData = JSON.stringify({
    template,
    variables,
    methods: mocks
});

console.log('Data size:', postData.length, 'bytes');
console.log('Template:', template);
console.log('Variables keys:', Object.keys(variables));
console.log('Mocks keys:', Object.keys(mocks));

const options = {
    hostname: 'localhost',
    port: 9876,
    path: '/render',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log('\nSending request...');

const req = http.request(options, (res) => {
    console.log('Response status:', res.statusCode);
    let body = '';
    
    res.on('data', (chunk) => {
        body += chunk;
    });
    
    res.on('end', () => {
        console.log('Success! Response:');
        console.log(body);
    });
});

req.on('error', (e) => {
    console.error('Request error:', e.message, e.code);
    console.error('Full error:', e);
});

req.write(postData);
req.end();
