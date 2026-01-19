const http = require('http');
const fs = require('fs');

const variables = JSON.parse(fs.readFileSync('example.vars.json', 'utf8'));
const mocksRaw = JSON.parse(fs.readFileSync('example.mocks.json', 'utf8'));

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

// Test different Velocity syntax
const templates = [
    'Test 1: $user.name',
    'Test 2: ${user.name}',
    'Test 3: $user.getEmail()',
    'Test 4: ${user.getEmail()}',
    'Test 5: #set($email = $user.getEmail())$email',
    'Test 6: $user.get("name")',
];

async function testTemplate(template) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ template, variables, methods: mocks });
        
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
                console.log(`Template: "${template}"`);
                console.log(`Result:   "${body}"`);
                console.log('---');
                resolve(body);
            });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

(async () => {
    for (const template of templates) {
        await testTemplate(template);
    }
})();
