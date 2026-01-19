const fs = require('fs');

const mocksRaw = JSON.parse(fs.readFileSync('example.mocks.json', 'utf8'));

console.log('Raw mocks structure:');
console.log(JSON.stringify(mocksRaw, null, 2));

console.log('\n\nConverted structure:');
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
console.log(JSON.stringify(mocks, null, 2));
