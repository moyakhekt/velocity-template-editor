const vscode = acquireVsCodeApi();

// Setup function to initialize event listeners
function setupEventListeners() {
    
    // Setup tab click handlers
    const tabs = document.querySelectorAll('.tab[data-tab]');
    
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', (e) => {
            switchTab(tab.getAttribute('data-tab'));
        });
    });

    // Setup event delegation for dynamically created elements
    document.addEventListener('click', (e) => {
        const target = e.target;
        
        // Use closest() to find the actual clickable element (handles clicks on child elements like icons)
        const button = target.closest('button[data-action]') || target.closest('.codicon[data-action]');
        
        if (button) {
            e.preventDefault();
            const action = button.getAttribute('data-action');

            switch (action) {
                // --- items with data attributes ---
                case 'deleteItem': {
                    const type = button.getAttribute('data-type');
                    const name = button.getAttribute('data-name') || '';
                    const obj = button.getAttribute('data-object') || '';
                    const prop = button.getAttribute('data-prop') || '';
                    const method = button.getAttribute('data-method') || '';
                    deleteItem(type, name, obj, prop, method);
                    break;
                }
                case 'deleteEnvironmentHeader':
                    deleteEnvironmentHeader(button.getAttribute('data-name'));
                    break;
                case 'deleteEnvironmentCspDirective':
                    deleteEnvironmentCspDirective(button.getAttribute('data-name'));
                    break;
                case 'deleteEnvironmentVariable':
                    deleteEnvironmentVariable(button.getAttribute('data-variable-name'));
                    break;
                case 'deleteEnvironmentMockFunction':
                    deleteEnvironmentMockFunction(button.getAttribute('data-name'));
                    break;
                case 'deleteScenario': {
                    const name = button.getAttribute('data-name');
                    if (name) { deleteScenarioByName(name); } else { deleteScenario(); }
                    break;
                }
                case 'deleteScenarioHeader':
                    deleteScenarioHeader(button.getAttribute('data-name'));
                    break;
                case 'deleteScenarioVariable':
                    deleteScenarioVariable(button.getAttribute('data-name'));
                    break;
                case 'deleteMessagesFile':
                    deleteMessagesFile(button.getAttribute('data-file-index'));
                    break;
                // --- no-arg actions ---
                case 'loadEnvironmentContext':      loadEnvironmentContext();      break;
                case 'reloadEnvironmentContext':    reloadEnvironmentContext();    break;
                case 'addEnvironmentHeader':        addEnvironmentHeader();        break;
                case 'addEnvironmentCspDirective':  addEnvironmentCspDirective();  break;
                case 'addEnvironmentVariable':      addEnvironmentVariable();      break;
                case 'addEnvironmentMockFunction':  addEnvironmentMockFunction();  break;
                case 'addScenario':                 addScenario();                 break;
                case 'addScenarioHeader':           addScenarioHeader();           break;
                case 'addScenarioVariable':         addScenarioVariable();         break;
                case 'browseMessagesFile':          browseMessagesFile();          break;
                case 'browseForPropertiesFile':     browseForPropertiesFile();     break;
                case 'saveEnvironmentContextAs':    saveEnvironmentContextAs();    break;
                case 'saveNewScenarioHeader':       saveNewScenarioHeader();       break;
                case 'cancelNewScenarioHeader':     cancelNewScenarioHeader();     break;
                case 'saveNewEnvironmentHeader':    saveNewEnvironmentHeader();    break;
                case 'cancelNewEnvironmentHeader':  cancelNewEnvironmentHeader();  break;
                case 'saveNewEnvironmentCspDirective':   saveNewEnvironmentCspDirective();   break;
                case 'cancelNewEnvironmentCspDirective': cancelNewEnvironmentCspDirective(); break;
                case 'saveNewEnvironmentVariable':   saveNewEnvironmentVariable();   break;
                case 'cancelNewEnvironmentVariable': cancelNewEnvironmentVariable(); break;
                case 'saveNewEnvironmentMockFunction':   saveNewEnvironmentMockFunction();   break;
                case 'cancelNewEnvironmentMockFunction': cancelNewEnvironmentMockFunction(); break;
                case 'saveNewScenarioVariable':     saveNewScenarioVariable();     break;
                case 'cancelNewScenarioVariable':   cancelNewScenarioVariable();   break;
                case 'saveNewScenario':             saveNewScenario();             break;
                case 'cancelNewScenario':           cancelNewScenario();           break;
                case 'addVariableToConfig':         addVariableToConfig();         break;
                case 'saveEnvironmentConfig':       saveEnvironmentConfig();       break;
                default:
                    // Intentionally unhandled — unknown actions are silently ignored
                    break;
            }
            return;
        }
        
        // Handle buttons with onclick attributes in innerHTML (legacy support)
        if (target.matches('button[onclick], .codicon[onclick]')) {
            e.preventDefault();
            const onclickAttr = target.getAttribute('onclick');
            if (onclickAttr) {
                // Execute the function
                const funcMatch = onclickAttr.match(/^(\w+)\((.*)\)$/);
                if (funcMatch) {
                    const funcName = funcMatch[1];
                    const args = funcMatch[2] ? funcMatch[2].split(',').map(a => a.trim().replace(/['"`]/g, '')) : [];
                    if (typeof window[funcName] === 'function') {
                        window[funcName](...args);
                    }
                }
            }
        }
        
        // Handle select onchange
        if (target.matches('select[onchange]')) {
            const onchangeAttr = target.getAttribute('onchange');
            if (onchangeAttr) {
                const funcMatch = onchangeAttr.match(/^(\w+)\((.*)\)$/);
                if (funcMatch) {
                    const funcName = funcMatch[1];
                    // Replace 'this.value' with actual value
                    const argsStr = funcMatch[2].replace(/this\.value/g, `'${target.value}'`);
                    const args = argsStr.split(',').map(a => a.trim().replace(/['"`]/g, ''));
                    if (typeof window[funcName] === 'function') {
                        window[funcName](...args);
                    }
                }
            }
        }
        
        // Handle table cell clicks for editing
        const editCell = target.closest('td[data-action="editHeaderCell"]');
        if (editCell) {
            const row = editCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editCell.querySelector('.header-cell-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
            return;
        }
        
        // Handle CSP directive cell clicks for editing
        const editCspDirectiveCell = target.closest('td[data-action="editCspDirectiveCell"]');
        if (editCspDirectiveCell) {
            const row = editCspDirectiveCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editCspDirectiveCell.querySelector('.header-cell-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
            return;
        }
        
        // Handle scenario name cell clicks for editing
        const editScenarioCell = target.closest('td[data-action="editScenarioName"]');
        if (editScenarioCell) {
            const oldName = editScenarioCell.getAttribute('data-old-name');
            if (oldName === 'Default') {
                return; // Don't allow editing Default scenario name
            }
            const row = editScenarioCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editScenarioCell.querySelector('.header-cell-input');
                const span = editScenarioCell.querySelector('.header-cell-value');
                if (input && span) {
                    span.style.display = 'none';
                    input.style.display = 'inline-block';
                    input.focus();
                    input.select();
                }
            }
            return;
        }
        
        // Handle URL cell clicks for editing
        const editUrlCell = target.closest('td[data-action="editUrlCell"]');
        if (editUrlCell) {
            const isEditable = editUrlCell.getAttribute('data-url-editable') === 'true';
            if (!isEditable) {
                return; // Don't allow editing when URL is inherited
            }
            const row = editUrlCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editUrlCell.querySelector('.header-cell-input');
                const span = editUrlCell.querySelector('.header-cell-value');
                if (input && span) {
                    span.style.display = 'none';
                    input.style.display = 'inline-block';
                    input.focus();
                    input.select();
                }
            }
            return;
        }
        
        // Handle Source cell clicks for editing
        const editSourceCell = target.closest('td[data-action="editSourceCell"]');
        if (editSourceCell) {
            const row = editSourceCell.closest('tr');
            if (row && !row.classList.contains('editing-source')) {
                row.classList.add('editing-source');
                const select = editSourceCell.querySelector('select.header-cell-input');
                if (select) select.focus();
            }
            return;
        }
        
        // Handle variable table cell clicks for editing
        const editVariableCell = target.closest('td[data-action="editVariableCell"]');
        if (editVariableCell) {
            const row = editVariableCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editVariableCell.querySelector('.header-cell-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
            return;
        }
        
        // Handle method mapping cell clicks for editing
        const editMethodMapping = target.closest('td[data-action="editMethodMapping"]');
        if (editMethodMapping) {
            const row = editMethodMapping.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const select = editMethodMapping.querySelector('.method-mapping-input');
                if (select) {
                    select.focus();
                }
            }
            return;
        }
        
        // Handle mock function cell clicks for editing
        const editMockCell = target.closest('td[data-action="editMockFunctionCell"]');
        if (editMockCell) {
            const row = editMockCell.closest('tr');
            if (row && !row.classList.contains('editing')) {
                row.classList.add('editing');
                const input = editMockCell.querySelector('input, textarea');
                if (input) {
                    input.focus();
                    if (input.tagName === 'INPUT') {
                        input.select();
                    }
                }
            }
            return;
        }
    });
    
    // Handle select change events
    document.addEventListener('change', (e) => {
        const target = e.target;
        if (target.hasAttribute('data-action')) {
        }
        
        // Handle checkbox toggles (e.g., JSON flag for scenario variables)
        if (target.matches('input[type="checkbox"][data-action]')) {
            const action = target.getAttribute('data-action');
            if (action === 'toggleScenarioVariableJson') {
                const name = target.getAttribute('data-name');
                vscode.postMessage({
                    command: 'toggleScenarioVariableJson',
                    name: name,
                    isJson: target.checked
                });
            }
            return;
        }

        // Handle data-action on radio inputs (e.g., scenario selection)
        if (target.matches('input[type="radio"][data-action]')) {
            const action = target.getAttribute('data-action');
            
            if (action === 'changeScenario') {
                
                // Before switching scenarios, save any pending edits
                // Find any rows in editing mode and trigger blur on their inputs
                const editingRows = document.querySelectorAll('tr.editing, tr.editing-source');
                editingRows.forEach(row => {
                    const inputs = row.querySelectorAll('input.header-cell-input:not([style*="display: none"]), select.header-cell-input:not([style*="display: none"])');
                    inputs.forEach(input => {
                        if (input.matches('input[data-action], select[data-action]')) {
                            input.blur();
                        }
                    });
                });
                
                // Also check for any focused input/textarea/select and blur it
                const focusedElement = document.activeElement;
                if (focusedElement && focusedElement.matches('input, textarea, select')) {
                    focusedElement.blur();
                }
                
                // Delay scenario switch to ensure blur events complete
                setTimeout(() => {
                    vscode.postMessage({
                        command: 'switchScenario',
                        scenario: target.value
                    });
                }, 100);
            } else if (action && typeof window[action] === 'function') {
                window[action]();
            }
            return;
        }
        
        // Handle data-action on select elements with data-* parameters
        if (target.matches('select[data-action]')) {
            const action = target.getAttribute('data-action');
            
            // Handle specific actions with parameters
            if (action === 'setVariableSource') {
                const name = target.getAttribute('data-name');
                setVariableSource(name, target.value);
            } else if (action === 'setPropertySource') {
                const obj = target.getAttribute('data-object');
                const prop = target.getAttribute('data-prop');
                setPropertySource(obj, prop, target.value);
            } else if (action === 'setMethodSource') {
                const obj = target.getAttribute('data-object');
                const method = target.getAttribute('data-method');
                setMethodSource(obj, method, target.value);
            } else if (action === 'saveMethodMapping') {
                const method = target.getAttribute('data-method');
                saveMethodMapping(method, target.value);
                // Exit editing mode and update display value
                const row = target.closest('tr');
                if (row) {
                    row.classList.remove('editing');
                    const displaySpan = row.querySelector('.method-mapping-value');
                    if (displaySpan) {
                        displaySpan.textContent = target.value || '-- Not Mapped --';
                    }
                }
            } else if (action === 'changeUrlSource') {
                changeUrlSource(target.value);
            } else if (action === 'changeScenarioVariableSource') {
                const name = target.getAttribute('data-name');
                vscode.postMessage({
                    command: 'changeScenarioVariableSource',
                    name: name,
                    source: target.value
                });
                // Update span text and collapse back to span view
                const cell = target.closest('td');
                const row = target.closest('tr');
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    if (span) span.textContent = target.value === 'self' ? 'Self' : target.value;
                }
                if (row) {
                    row.classList.remove('editing-source');
                }
            } else if (action && typeof window[action] === 'function') {
                window[action]();
            }
            return;
        }
        
        // Legacy: Handle select onchange
        if (target.matches('select[onchange]')) {
            const onchangeAttr = target.getAttribute('onchange');
            if (onchangeAttr) {
                const funcMatch = onchangeAttr.match(/^(\w+)\((.*)\)$/);
                if (funcMatch) {
                    const funcName = funcMatch[1];
                    const argsStr = funcMatch[2].replace(/this\.value/g, `'${target.value}'`);
                    const args = argsStr.split(',').map(a => a.trim().replace(/['"`]/g, ''));
                    if (typeof window[funcName] === 'function') {
                        window[funcName](...args);
                    }
                }
            }
        }
    });

    // Handle blur events for inputs/textareas with data-action
    document.addEventListener('blur', (e) => {
        const target = e.target;
        
        if (target.matches('input[data-action], textarea[data-action]')) {
            const action = target.getAttribute('data-action');
            
            // Handle specific actions with parameters
            if (action === 'saveValue') {
                const name = target.getAttribute('data-name') || '';
                const obj = target.getAttribute('data-object') || '';
                const prop = target.getAttribute('data-prop') || '';
                saveValue(name, obj, prop);
            } else if (action === 'saveMethod') {
                const obj = target.getAttribute('data-object');
                const method = target.getAttribute('data-method');
                saveMethod(obj, method);
            } else if (action === 'saveEnvironmentValue') {
                const name = target.getAttribute('data-name') || '';
                const obj = target.getAttribute('data-object') || '';
                const prop = target.getAttribute('data-prop') || '';
                saveEnvironmentValue(name, obj, prop);
            } else if (action === 'saveEnvironmentMethod') {
                const obj = target.getAttribute('data-object');
                const method = target.getAttribute('data-method');
                saveEnvironmentMethod(obj, method);
            } else if (action === 'saveEnvironmentHeaderRow') {
                const oldName = target.getAttribute('data-old-name');
                const part = target.getAttribute('data-header-part');
                const row = target.closest('tr');
                
                // Save the value
                saveEnvironmentHeaderRow(oldName, part, target.value);
                
                // Update display value
                const span = target.parentElement.querySelector('.header-cell-value');
                if (span) {
                    span.textContent = target.value || '(empty)';
                }
                
                // Update row's data-header-name if name was changed
                if (part === 'name') {
                    row.setAttribute('data-header-name', target.value);
                    // Update all inputs' data-old-name
                    row.querySelectorAll('.header-cell-input').forEach(input => {
                        input.setAttribute('data-old-name', target.value);
                    });
                }
                
                // Remove editing class when focus leaves row
                setTimeout(() => {
                    const activeElement = document.activeElement;
                    const focusInRow = row && row.contains(activeElement);
                    if (!focusInRow) {
                        row.classList.remove('editing');
                    }
                }, 100);
            } else if (action === 'saveEnvironmentCspDirectiveRow') {
                const oldName = target.getAttribute('data-old-name');
                const part = target.getAttribute('data-directive-part');
                const row = target.closest('tr');
                
                // Save the value
                saveEnvironmentCspDirectiveRow(oldName, part, target.value);
                
                // Update display value
                const span = target.parentElement.querySelector('.header-cell-value');
                if (span) {
                    span.textContent = target.value || '(empty)';
                }
                
                // Update row's data-csp-directive if name was changed
                if (part === 'name') {
                    row.setAttribute('data-csp-directive', target.value);
                    // Update all inputs' data-old-name
                    row.querySelectorAll('.header-cell-input').forEach(input => {
                        input.setAttribute('data-old-name', target.value);
                    });
                }
                
                // Remove editing class when focus leaves row
                setTimeout(() => {
                    const activeElement = document.activeElement;
                    const focusInRow = row && row.contains(activeElement);
                    if (!focusInRow) {
                        row.classList.remove('editing');
                    }
                }, 100);
            } else if (action === 'saveEnvironmentVariableRow') {
                const oldName = target.closest('tr').getAttribute('data-variable-name');
                const part = target.getAttribute('data-variable-part');
                const row = target.closest('tr');
                
                // Save the value
                saveEnvironmentVariableRow(oldName, part, target.value);
                
                // Update display value
                const span = target.parentElement.querySelector('.header-cell-value');
                if (span) {
                    span.textContent = target.value || '(empty)';
                }
                
                // Update row's data-variable-name if name was changed
                if (part === 'name') {
                    row.setAttribute('data-variable-name', target.value);
                }
                
                // Remove editing class when focus leaves row
                setTimeout(() => {
                    const activeElement = document.activeElement;
                    const focusInRow = row && row.contains(activeElement);
                    if (!focusInRow) {
                        row.classList.remove('editing');
                    }
                }, 100);
            } else if (action === 'editScenarioHeader') {
                const field = target.getAttribute('data-field');
                const name = target.getAttribute('data-name');
                const scenario = target.getAttribute('data-scenario');
                const row = target.closest('tr');
                if (field === 'value' && name) {
                    // Save scenario header value
                    vscode.postMessage({
                        command: 'saveScenarioHeaderValue',
                        name: name,
                        value: target.value,
                        scenario: scenario
                    });
                    if (row) {
                        row.classList.remove('editing');
                        const span = target.parentElement.querySelector('.header-cell-value');
                        if (span) {
                            span.textContent = target.value || '(empty)';
                        }
                    }
                }
            } else if (action === 'editScenarioVariable') {
                const field = target.getAttribute('data-field');
                const name = target.getAttribute('data-name');
                const scenario = target.getAttribute('data-scenario');
                const row = target.closest('tr');
                if (field === 'value' && name) {
                    // Save scenario variable value
                    vscode.postMessage({
                        command: 'saveScenarioVariableValue',
                        name: name,
                        value: target.value,
                        scenario: scenario
                    });
                    if (row) {
                        row.classList.remove('editing');
                        const span = target.parentElement.querySelector('.header-cell-value');
                        if (span) {
                            span.textContent = target.value || '(empty)';
                        }
                    }
                }
            } else if (action === 'saveScenarioName') {
                const oldName = target.getAttribute('data-old-name');
                const newName = target.value.trim();
                const row = target.closest('tr');
                const cell = target.closest('td');
                
                if (!newName) {
                    // Revert to old name if empty
                    if (cell) {
                        const span = cell.querySelector('.header-cell-value');
                        const input = cell.querySelector('.header-cell-input');
                        if (span && input) {
                            span.style.display = 'inline';
                            input.style.display = 'none';
                        }
                    }
                    if (row) {
                        row.classList.remove('editing');
                    }
                    return;
                }
                
                if (oldName !== newName) {
                    // Send rename command to backend
                    vscode.postMessage({
                        command: 'renameScenario',
                        oldName: oldName,
                        newName: newName
                    });
                }
                
                // Hide input, show span
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const input = cell.querySelector('.header-cell-input');
                    if (span && input) {
                        span.textContent = newName;
                        span.style.display = 'inline';
                        input.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing');
                }
            } else if (action === 'saveTemplateUrl') {
                const newUrl = target.value.trim();
                const scenario = target.getAttribute('data-scenario');
                const row = target.closest('tr');
                const cell = target.closest('td');
                
                // Send update to backend with scenario tracking
                vscode.postMessage({
                    command: 'saveTemplateUrl',
                    url: newUrl,
                    scenario: scenario
                });
                
                // Update display
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const input = cell.querySelector('.header-cell-input');
                    if (span && input) {
                        span.innerHTML = newUrl ? escapeHtml(newUrl) : '<span style="opacity: 0.5;">Not set</span>';
                        span.style.display = 'inline';
                        input.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing');
                }
            } else if (action === 'changeUrlSource') {
                const newSource = target.value;
                const row = target.closest('tr');
                const cell = target.closest('td');
                
                // Send update to backend
                changeUrlSource(newSource);
                
                // Update display
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const select = cell.querySelector('.header-cell-input');
                    if (span && select) {
                        span.textContent = newSource;
                        span.style.display = 'inline';
                        select.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing-source');
                }
            } else if (action === 'saveEnvironmentMockFunctionRow') {
                const row = target.closest('tr');
                const oldName = row ? row.getAttribute('data-mock-name') : '';

                saveEnvironmentMockFunctionRow(oldName, target.value);

                const span = target.parentElement.querySelector('.header-cell-value');
                if (span) {
                    span.innerHTML = escapeHtml(target.value || '(empty)').replace(/\n/g, '<br>');
                }

                setTimeout(() => {
                    const activeElement = document.activeElement;
                    const focusInRow = row && row.contains(activeElement);
                    if (!focusInRow) {
                        row.classList.remove('editing');
                    }
                }, 100);
            } else if (action && typeof window[action] === 'function') {
                window[action]();
            }
        }
        
        // Handle blur for scenario variable source dropdown
        if (target.matches('select[data-action="changeScenarioVariableSource"]')) {
            const row = target.closest('tr');
            if (row) {
                row.classList.remove('editing-source');
            }
        }

        // Handle blur for Source dropdown (when clicked away without changing)
        if (target.matches('select[data-action="changeUrlSource"]')) {
            const row = target.closest('tr');
            const cell = target.closest('td');
            
            // Hide select, show span
            if (cell) {
                const span = cell.querySelector('.header-cell-value');
                const select = cell.querySelector('.header-cell-input');
                if (span && select) {
                    span.style.display = 'inline';
                    select.style.display = 'none';
                }
            }
            
            if (row) {
                row.classList.remove('editing-source');
            }
        }
    }, true); // Use capture to ensure we catch blur events

    // Handle keydown events for Enter/Escape in inline editors
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        
        // Handle Enter and Escape for scenario name editing
        if (target.matches('input[data-action="saveScenarioName"]')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                target.blur(); // Trigger blur to save
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const oldName = target.getAttribute('data-old-name');
                const cell = target.closest('td');
                const row = target.closest('tr');
                
                // Revert to old name
                target.value = oldName;
                
                // Hide input, show span
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const input = cell.querySelector('.header-cell-input');
                    if (span && input) {
                        span.style.display = 'inline';
                        input.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing');
                }
            }
        }
        
        // Handle Enter and Escape for URL editing
        if (target.matches('input[data-action="saveTemplateUrl"]')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                target.blur(); // Trigger blur to save
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const cell = target.closest('td');
                const row = target.closest('tr');
                
                // Revert to original value
                const originalUrl = target.defaultValue;
                target.value = originalUrl;
                
                // Hide input, show span
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const input = cell.querySelector('.header-cell-input');
                    if (span && input) {
                        span.style.display = 'inline';
                        input.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing');
                }
            }
        }
        
        // Handle Escape for Source dropdown
        if (target.matches('select[data-action="changeUrlSource"]')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                const cell = target.closest('td');
                const row = target.closest('tr');
                
                // Hide select, show span
                if (cell) {
                    const span = cell.querySelector('.header-cell-value');
                    const select = cell.querySelector('.header-cell-input');
                    if (span && select) {
                        span.style.display = 'inline';
                        select.style.display = 'none';
                    }
                }
                
                if (row) {
                    row.classList.remove('editing-source');
                }
            }
            // Note: For select, change event triggers automatically on selection, no need for Enter
        }
    });

    const state = vscode.getState();
    if (state) {
        if (state.scrollPosition) {
            window.scrollTo(0, state.scrollPosition);
        }
        if (state.activeTab) {
            switchTab(state.activeTab);
        }
    }
    
    // Initialize URL input disabled state based on source
    const urlInput = document.getElementById('template-url');
    const urlSource = document.getElementById('url-source');
    if (urlInput && urlSource) {
        urlInput.disabled = (urlSource.value !== 'self');
    }
    
}

// Call setup immediately if DOM is ready, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventListeners);
} else {
    setupEventListeners();
}

let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(saveScrollState, 100);
});

// Listen for DOM update messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'upsertEnvironmentHeaderRow':
            upsertEnvironmentHeaderRowDOM(message);
            break;
        case 'deleteEnvironmentHeaderRow':
            deleteEnvironmentHeaderRowDOM(message);
            break;
        case 'upsertEnvironmentCspDirectiveRow':
            upsertEnvironmentCspDirectiveRowDOM(message);
            break;
        case 'deleteEnvironmentCspDirectiveRow':
            deleteEnvironmentCspDirectiveRowDOM(message);
            break;
        case 'upsertEnvironmentVariableRow':
            upsertEnvironmentVariableRowDOM(message);
            break;
        case 'deleteEnvironmentVariableRow':
            deleteEnvironmentVariableRowDOM(message);
            break;
        case 'upsertEnvironmentMockFunctionRow':
            upsertEnvironmentMockFunctionRowDOM(message);
            break;
        case 'deleteEnvironmentMockFunctionRow':
            deleteEnvironmentMockFunctionRowDOM(message);
            break;
        case 'showRowError':
            showRowError(message);
            break;
        case 'availableScenarioVariables':
            // Received available variables from backend, now show the row with dropdown
            showNewRow({ 
                type: 'scenarioVariable',
                availableVariables: message.variables || [],
                scenarios: message.scenarios || []
            });
            break;
        case 'updateVariable':
            updateVariableDOM(message);
            break;
        case 'deleteVariable':
            deleteVariableDOM(message);
            break;
        case 'updateProperty':
            updatePropertyDOM(message);
            break;
        case 'deleteProperty':
            deletePropertyDOM(message);
            break;
        case 'updateMethod':
            updateMethodDOM(message);
            break;
        case 'deleteMethod':
            deleteMethodDOM(message);
            break;
        case 'updateEnvironmentVariable':
            updateEnvironmentVariableDOM(message);
            break;
        case 'deleteEnvironmentVariable':
            deleteEnvironmentVariableDOM(message);
            break;
        case 'updateScenarioVariable':
            updateScenarioVariableDOM(message);
            break;
        case 'deleteScenarioVariable':
            deleteScenarioVariableDOM(message);
            break;
        case 'updateScenario':
            updateScenarioDOM(message);
            break;
        case 'updateUrl':
            updateUrlDOM(message);
            break;
        case 'removeFromDropdown':
            removeOptionFromDropdown(message);
            break;
        case 'addToDropdown':
            addOptionToDropdown(message);
            break;
        case 'updateScenarioSection':
            updateScenarioSectionDOM(message);
            break;
        case 'hideVariableRow':
            hideVariableRowDOM(message);
            break;
        case 'showVariableRow':
            showVariableRowDOM(message);
            break;
        case 'showStatus':
            // Status messages are handled by VS Code
            break;
    }
});

// DOM manipulation functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateVariableDOM(msg) {
    const row = document.querySelector(`tr[data-var="${msg.name}"]`);
    if (row) {
        const valueInput = row.querySelector('input[type="text"]');
        if (valueInput && msg.value !== undefined) {
            valueInput.value = typeof msg.value === 'string' ? msg.value : JSON.stringify(msg.value);
        }
        const sourceSelect = row.querySelector('.source-select');
        if (sourceSelect && msg.source) {
            sourceSelect.value = msg.source;
        }
    } else {
        const tbody = document.querySelector('#template-tab .variable-table tbody');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.setAttribute('data-var', msg.name);
            const isReadOnly = msg.source === 'environment';
            const valueStr = typeof msg.value === 'string' ? msg.value : JSON.stringify(msg.value);
            
            // Column 1: Variable name
            const col1 = document.createElement('td');
            const code = document.createElement('code');
            code.textContent = '$' + msg.name;
            col1.appendChild(code);
            tr.appendChild(col1);
            
            // Column 2: Source select
            const col2 = document.createElement('td');
            const select = document.createElement('select');
            select.className = 'source-select';
            const optEnvironment = document.createElement('option');
            optEnvironment.value = 'environment';
            optEnvironment.textContent = 'Environment Context';
            optEnvironment.selected = msg.source === 'environment';
            const optTemplate = document.createElement('option');
            optTemplate.value = 'template';
            optTemplate.textContent = 'Template Context';
            optTemplate.selected = msg.source === 'template';
            select.appendChild(optEnvironment);
            select.appendChild(optTemplate);
            select.addEventListener('change', () => changeTemplateVariableSource(msg.name, select.value));
            col2.appendChild(select);
            tr.appendChild(col2);
            
            // Column 3: Value (readonly span or editable input)
            const col3 = document.createElement('td');
            if (isReadOnly) {
                const span = document.createElement('span');
                span.className = 'value-readonly';
                span.textContent = valueStr;
                col3.appendChild(span);
            } else {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'value-input';
                input.value = valueStr;
                input.addEventListener('change', () => saveTemplateVariableValue(msg.name, input.value));
                col3.appendChild(input);
            }
            tr.appendChild(col3);
            
            // Column 4: Delete button
            const col4 = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-small';
            deleteBtn.title = 'Delete variable';
            const icon = document.createElement('i');
            icon.className = 'codicon codicon-close';
            deleteBtn.appendChild(icon);
            deleteBtn.addEventListener('click', () => deleteTemplateVariable(msg.name));
            col4.appendChild(deleteBtn);
            tr.appendChild(col4);
            
            const addRow = tbody.querySelector('#template-add-row');
            if (addRow) {
                tbody.insertBefore(tr, addRow);
            } else {
                tbody.appendChild(tr);
            }
        }
    }
}

function deleteVariableDOM(msg) {
    const row = document.querySelector(`tr[data-var="${msg.name}"]`);
    if (row) {
        row.remove();
    }
}

function updatePropertyDOM(msg) {
    const row = document.querySelector(`tr[data-prop="${msg.objectName}.${msg.propertyName}"]`);
    if (row) {
        const valueCell = row.querySelector('.value-cell input');
        if (valueCell && msg.value !== undefined) {
            valueCell.value = typeof msg.value === 'string' ? msg.value : JSON.stringify(msg.value);
        }
        const sourceSelect = row.querySelector('.source-select');
        if (sourceSelect && msg.source) {
            sourceSelect.value = msg.source;
        }
    }
}

function deletePropertyDOM(msg) {
    const row = document.querySelector(`tr[data-prop="${msg.objectName}.${msg.propertyName}"]`);
    if (row) {
        row.remove();
    }
}

function updateMethodDOM(msg) {
    const textarea = document.getElementById(`method-${msg.objectName}-${msg.methodName}`);
    if (textarea && msg.implementation !== undefined) {
        textarea.value = msg.implementation;
    }
}

function deleteMethodDOM(msg) {
    const methodSection = document.querySelector(`.context-item[data-method="${msg.objectName}.${msg.methodName}"]`);
    if (methodSection) {
        methodSection.remove();
    }
}

function updateEnvironmentVariableDOM(msg) {
    const row = document.querySelector(`#environment-tab tr[data-var="${msg.name}"]`);
    if (row) {
        const valueInput = row.querySelector('input[type="text"]');
        if (valueInput && msg.value !== undefined) {
            valueInput.value = typeof msg.value === 'string' ? msg.value : JSON.stringify(msg.value);
        }
    } else {
        const tbody = document.querySelector('#environment-tab .variable-table tbody');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.setAttribute('data-var', msg.name);
            const valueStr = typeof msg.value === 'string' ? msg.value : JSON.stringify(msg.value);
            
            // Column 1: Variable name
            const col1 = document.createElement('td');
            const code = document.createElement('code');
            code.textContent = '$' + msg.name;
            col1.appendChild(code);
            tr.appendChild(col1);
            
            // Column 2: Source label
            const col2 = document.createElement('td');
            const span = document.createElement('span');
            span.className = 'value-readonly';
            span.textContent = 'Environment Context';
            col2.appendChild(span);
            tr.appendChild(col2);
            
            // Column 3: Value input
            const col3 = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'value-input';
            input.value = valueStr;
            input.addEventListener('change', () => saveEnvironmentVariableValue(msg.name, input.value));
            col3.appendChild(input);
            tr.appendChild(col3);
            
            // Column 4: Delete button
            const col4 = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-small';
            deleteBtn.title = 'Delete variable';
            const icon = document.createElement('i');
            icon.className = 'codicon codicon-close';
            deleteBtn.appendChild(icon);
            deleteBtn.addEventListener('click', () => deleteEnvironmentVariable(msg.name));
            col4.appendChild(deleteBtn);
            tr.appendChild(col4);
            
            const addRow = tbody.querySelector('#environment-add-row');
            if (addRow) {
                tbody.insertBefore(tr, addRow);
            } else {
                tbody.appendChild(tr);
            }
        }
    }
}

function deleteEnvironmentVariableDOM(msg) {
    const row = document.querySelector(`#environment-tab tr[data-var="${msg.name}"]`);
    if (row) {
        row.remove();
    }
}

function upsertEnvironmentMockFunctionRowDOM(msg) {
    const container = document.getElementById('environment-mock-functions-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;

    const name = msg.name || '';
    const implementation = msg.implementation !== undefined ? String(msg.implementation) : '';
    const oldName = msg.oldName || '';

    const newRow = tbody.querySelector('tr[data-mock-name="__new__"]');
    if (newRow) {
        newRow.remove();
        const addButton = document.getElementById('add-environment-mock-function-btn');
        if (addButton) addButton.disabled = false;
    }

    let row = null;
    if (oldName) {
        row = tbody.querySelector(`tr[data-mock-name="${cssEscape(oldName)}"]`);
    }
    if (!row) {
        row = tbody.querySelector(`tr[data-mock-name="${cssEscape(name)}"]`);
    }

    const implDisplay = escapeHtml(implementation || '(empty)').replace(/\n/g, '<br>');

    if (!row) {
        row = document.createElement('tr');
        row.className = 'header-row';
        row.setAttribute('data-mock-name', name);
        row.innerHTML = `
            <td data-action="editMockFunctionCell">
                <span class="header-cell-value mock-implementation-value">${implDisplay}</span>
                <textarea class="mock-implementation-input" data-action="saveEnvironmentMockFunctionRow" data-old-name="${escapeHtml(name)}" placeholder="function myFunction(args) {\n  return args[0];\n}">${escapeHtml(implementation)}</textarea>
            </td>
            <td style="text-align: center;">
                <button class="icon-button" data-action="deleteEnvironmentMockFunction" data-name="${escapeHtml(name)}" title="Delete">
                    <span class="codicon codicon-trash"></span>
                </button>
            </td>
        `;

        const addRow = tbody.querySelector('.add-row');
        if (addRow) {
            tbody.insertBefore(row, addRow);
        } else {
            tbody.appendChild(row);
        }
    } else {
        row.setAttribute('data-mock-name', name);

        const implSpan = row.querySelector('.header-cell-value');
        const implInput = row.querySelector('textarea');
        if (implSpan) implSpan.innerHTML = implDisplay;
        if (implInput) {
            implInput.value = implementation;
            implInput.setAttribute('data-old-name', name);
        }

        const deleteButton = row.querySelector('button[data-action="deleteEnvironmentMockFunction"]');
        if (deleteButton) {
            deleteButton.setAttribute('data-name', name);
        }
    }
}

function deleteEnvironmentMockFunctionRowDOM(msg) {
    const container = document.getElementById('environment-mock-functions-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;
    const row = tbody.querySelector(`tr[data-mock-name="${cssEscape(msg.name)}"]`);
    if (row) {
        row.remove();
    }
}

function updateScenarioVariableDOM(msg) {
    const row = document.querySelector(`#template-tab tr[data-scenario-var="${msg.name}"]`);
    if (row) {
        const valueCell = row.querySelector('.value-cell input');
        if (valueCell && msg.value !== undefined) {
            valueCell.value = msg.value;
        }
        const sourceSelect = row.querySelector('.source-select');
        if (sourceSelect && msg.source) {
            sourceSelect.value = msg.source;
        }
    } else {
        const tbody = document.querySelector('#scenario-vars-table tbody');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.setAttribute('data-scenario-var', msg.name);
            
            // Column 1: Variable name
            const col1 = document.createElement('td');
            col1.textContent = '$' + msg.name;
            tr.appendChild(col1);
            
            // Column 2: Source select
            const col2 = document.createElement('td');
            const select = document.createElement('select');
            select.className = 'source-select';
            const optScenario = document.createElement('option');
            optScenario.value = 'scenario';
            optScenario.textContent = 'Scenario Context (Self)';
            optScenario.selected = msg.source === 'scenario';
            const optTemplate = document.createElement('option');
            optTemplate.value = 'template';
            optTemplate.textContent = 'Template Context';
            optTemplate.selected = msg.source === 'template';
            const optEnvironment = document.createElement('option');
            optEnvironment.value = 'environment';
            optEnvironment.textContent = 'Environment Context';
            optEnvironment.selected = msg.source === 'environment';
            select.appendChild(optScenario);
            select.appendChild(optTemplate);
            select.appendChild(optEnvironment);
            select.addEventListener('change', () => changeScenarioVariableSource(msg.name, select.value));
            col2.appendChild(select);
            tr.appendChild(col2);
            
            // Column 3: Value input
            const col3 = document.createElement('td');
            col3.className = 'value-cell';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = msg.value;
            input.addEventListener('blur', () => saveScenarioVariable(msg.name, input.value));
            col3.appendChild(input);
            tr.appendChild(col3);
            
            // Column 4: Delete button
            const col4 = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-button';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => requestDelete('deleteScenarioVariable', msg.name));
            col4.appendChild(deleteBtn);
            tr.appendChild(col4);
            
            const addRow = tbody.querySelector('#scenario-add-row');
            if (addRow) {
                tbody.insertBefore(tr, addRow);
            } else {
                tbody.appendChild(tr);
            }
        }
    }
}

function deleteScenarioVariableDOM(msg) {
    const row = document.querySelector(`#scenario-variables-tbody tr[data-variable-name="${cssEscape(msg.name)}"]`);
    if (row) {
        row.remove();
    }
}

function buildScenarioHeaderRow(header) {
    const tr = document.createElement('tr');
    const isSelf = header.source === 'self';

    const tdName = document.createElement('td');
    tdName.textContent = header.name;
    tr.appendChild(tdName);

    const tdValue = document.createElement('td');
    if (isSelf) { tdValue.setAttribute('data-action', 'editHeaderCell'); }
    const span = document.createElement('span');
    span.className = 'header-cell-value';
    span.textContent = header.value || '(empty)';
    tdValue.appendChild(span);
    if (isSelf) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = header.value;
        input.dataset.action = 'editScenarioHeader';
        input.dataset.field = 'value';
        input.dataset.name = header.name;
        input.className = 'header-cell-input';
        tdValue.appendChild(input);
    }
    tr.appendChild(tdValue);

    const tdSource = document.createElement('td');
    tdSource.style.cssText = 'font-size: 0.9em; color: var(--vscode-descriptionForeground);';
    tdSource.textContent = header.source === 'self' ? 'Self' : header.source === 'environment' ? 'Environment' : header.source;
    tr.appendChild(tdSource);

    const tdAction = document.createElement('td');
    if (isSelf) {
        const btn = document.createElement('button');
        btn.className = 'icon-button';
        btn.dataset.action = 'deleteScenarioHeader';
        btn.dataset.name = header.name;
        btn.title = 'Delete';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-trash';
        btn.appendChild(icon);
        tdAction.appendChild(btn);
    }
    tr.appendChild(tdAction);

    return tr;
}

function buildScenarioVariableRow(variable) {
    const tr = document.createElement('tr');
    const isSelf = variable.source === 'self';
    const hasInheritable = Array.isArray(variable.inheritableFrom) && variable.inheritableFrom.length > 0;

    const tdName = document.createElement('td');
    tdName.textContent = variable.name;
    tr.appendChild(tdName);

    const tdValue = document.createElement('td');
    if (isSelf) { tdValue.setAttribute('data-action', 'editVariableCell'); }
    const valueSpan = document.createElement('span');
    valueSpan.className = 'header-cell-value';
    if (!isSelf) { valueSpan.style.cssText = 'color:var(--vscode-descriptionForeground);font-style:italic;'; }
    valueSpan.textContent = variable.value || '(empty)';
    tdValue.appendChild(valueSpan);
    if (isSelf) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = variable.value;
        input.dataset.action = 'editScenarioVariable';
        input.dataset.field = 'value';
        input.dataset.name = variable.name;
        input.className = 'header-cell-input';
        tdValue.appendChild(input);
    }
    tr.appendChild(tdValue);

    const tdJson = document.createElement('td');
    tdJson.style.cssText = 'text-align:center;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.title = isSelf ? 'Parse value as JSON array/object' : 'JSON parsing (inherited, read-only)';
    checkbox.checked = variable.isJson;
    if (isSelf) {
        checkbox.dataset.action = 'toggleScenarioVariableJson';
        checkbox.dataset.name = variable.name;
    } else {
        checkbox.disabled = true;
    }
    tdJson.appendChild(checkbox);
    tr.appendChild(tdJson);

    const tdSource = document.createElement('td');
    if (hasInheritable) {
        tdSource.setAttribute('data-action', 'editSourceCell');
        tdSource.style.cursor = 'pointer';
    } else {
        tdSource.style.cursor = 'default';
    }
    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'header-cell-value';
    if (!isSelf) { sourceSpan.style.cssText = 'color:var(--vscode-descriptionForeground);font-style:italic;'; }
    sourceSpan.textContent = variable.source === 'self' ? 'Self' : variable.source;
    tdSource.appendChild(sourceSpan);
    if (hasInheritable) {
        const select = document.createElement('select');
        select.className = 'header-cell-input scenario-source-select';
        select.dataset.action = 'changeScenarioVariableSource';
        select.dataset.name = variable.name;
        const selfOpt = document.createElement('option');
        selfOpt.value = 'self';
        selfOpt.textContent = 'Self';
        selfOpt.selected = variable.source === 'self';
        select.appendChild(selfOpt);
        for (const sn of variable.inheritableFrom) {
            const opt = document.createElement('option');
            opt.value = sn;
            opt.textContent = sn;
            opt.selected = variable.source === sn;
            select.appendChild(opt);
        }
        tdSource.appendChild(select);
    }
    tr.appendChild(tdSource);

    const tdAction = document.createElement('td');
    if (isSelf) {
        const btn = document.createElement('button');
        btn.className = 'icon-button';
        btn.dataset.action = 'deleteScenarioVariable';
        btn.dataset.name = variable.name;
        btn.title = 'Delete';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-trash';
        btn.appendChild(icon);
        tdAction.appendChild(btn);
    }
    tr.appendChild(tdAction);

    return tr;
}

function updateScenarioDOM(msg) {
    
    // 0. Update checked radio button for scenario selection
    const radioButtons = document.querySelectorAll('input[type="radio"][name="scenario"]');
    radioButtons.forEach(radio => {
        if (radio.value === msg.scenarioName) {
            radio.checked = true;
        } else {
            radio.checked = false;
        }
    });
    
    // 1. Update scenario title
    const scenarioTitle = document.querySelector('.scenario-title');
    if (scenarioTitle) {
        scenarioTitle.textContent = msg.scenarioName;
    }
    
    // 2. Update URL value and source
    const urlInput = document.getElementById('template-url');
    if (urlInput) {
        urlInput.value = msg.url || '';
        // Disable URL input if not using Self
        urlInput.disabled = (msg.urlSource !== 'Self');
        
        // Also update the display span (sibling of the input)
        const urlCell = urlInput.closest('td');
        if (urlCell) {
            const urlDisplay = urlCell.querySelector('.header-cell-value');
            if (urlDisplay) {
                if (msg.url && msg.url.trim()) {
                    urlDisplay.textContent = msg.url;
                    urlDisplay.style.opacity = '1';
                } else {
                    urlDisplay.innerHTML = '<span style="opacity: 0.5;">Not set</span>';
                }
            }
        }
    }
    
    // Update URL source display span
    const urlSourceSelect = document.getElementById('url-source');
    if (urlSourceSelect) {
        const urlSourceCell = urlSourceSelect.closest('td');
        if (urlSourceCell) {
            const urlSourceDisplay = urlSourceCell.querySelector('.header-cell-value');
            if (urlSourceDisplay) {
                urlSourceDisplay.textContent = msg.urlSource || 'Self';
            }
        }
    }
    
    // Update URL source dropdown using structured data
    const urlSource = document.getElementById('url-source');
    if (urlSource && Array.isArray(msg.urlSourceOptions)) {
        urlSource.innerHTML = '';
        for (const opt of msg.urlSourceOptions) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            option.selected = opt.selected;
            urlSource.appendChild(option);
        }
    }

    // 3. Update Scenario Headers
    const headersTableBody = document.getElementById('scenario-headers-tbody');
    if (headersTableBody && Array.isArray(msg.headers)) {
        headersTableBody.innerHTML = '';
        for (const h of msg.headers) {
            headersTableBody.appendChild(buildScenarioHeaderRow(h));
        }
        const addRow = document.createElement('tr');
        addRow.className = 'add-row';
        const addTd = document.createElement('td');
        addTd.colSpan = 4;
        const addBtn = document.createElement('button');
        addBtn.className = 'add-table-row-button';
        addBtn.setAttribute('data-action', 'addScenarioHeader');
        addBtn.textContent = 'Add Header';
        addTd.appendChild(addBtn);
        addRow.appendChild(addTd);
        headersTableBody.appendChild(addRow);
    }

    // 4. Update Scenario Variables
    const variablesTableBody = document.getElementById('scenario-variables-tbody');
    if (variablesTableBody && Array.isArray(msg.variables)) {
        variablesTableBody.innerHTML = '';
        for (const v of msg.variables) {
            variablesTableBody.appendChild(buildScenarioVariableRow(v));
        }
        const addVarRow = document.createElement('tr');
        addVarRow.className = 'add-row';
        const addVarTd = document.createElement('td');
        addVarTd.colSpan = 5;
        const addVarBtn = document.createElement('button');
        addVarBtn.className = 'add-table-row-button';
        addVarBtn.setAttribute('data-action', 'addScenarioVariable');
        addVarBtn.textContent = 'Add Variable';
        addVarTd.appendChild(addVarBtn);
        addVarRow.appendChild(addVarTd);
        variablesTableBody.appendChild(addVarRow);
    }
    
}

function updateUrlDOM(msg) {
    // Update URL value and display
    const urlInput = document.getElementById('template-url');
    const urlCell = urlInput ? urlInput.closest('td') : null;
    
    if (urlInput) {
        urlInput.value = msg.url || '';
        // Disable URL input if not using Self
        urlInput.disabled = (msg.urlSource !== 'Self');
        
        // Update the span display
        if (urlCell) {
            const urlSpan = urlCell.querySelector('.header-cell-value');
            if (urlSpan) {
                urlSpan.innerHTML = msg.url ? escapeHtml(msg.url) : '<span style="opacity: 0.5;">Not set</span>';
            }
            // Update data attribute for editability
            urlCell.setAttribute('data-url-editable', msg.urlSource === 'Self' ? 'true' : 'false');
        }
    }
    
    // Update URL source dropdown value and display
    const urlSource = document.getElementById('url-source');
    const sourceCell = urlSource ? urlSource.closest('td') : null;
    
    if (urlSource) {
        // Set the select value - urlSource can be 'Self' or any scenario name
        if (msg.urlSource === 'Self') {
            urlSource.value = 'self';
        } else {
            // It's a scenario name
            urlSource.value = msg.urlSource;
        }
        
        // Update the span display
        if (sourceCell) {
            const sourceSpan = sourceCell.querySelector('.header-cell-value');
            if (sourceSpan) {
                sourceSpan.textContent = msg.urlSource || 'Self';
            }
        }
    }
}

function removeOptionFromDropdown(msg) {
    const dropdown = document.getElementById(msg.dropdownId);
    if (dropdown) {
        const option = dropdown.querySelector(`option[value="${msg.value}"]`);
        if (option) {
            option.remove();
        }
    }
}

function addOptionToDropdown(msg) {
    const dropdown = document.getElementById(msg.dropdownId);
    if (dropdown) {
        const option = document.createElement('option');
        option.value = msg.value;
        option.textContent = msg.text;
        let inserted = false;
        for (let i = 1; i < dropdown.options.length; i++) {
            if (dropdown.options[i].text > msg.text) {
                dropdown.insertBefore(option, dropdown.options[i]);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            dropdown.appendChild(option);
        }
    }
}

// Handle scenario variable rows display
function handleScenarioVariablesDisplay(msg) {
    if (msg.variables) {
        const tbody = document.querySelector('#scenario-variables tbody');
        const addRow = document.getElementById('scenario-add-row');
        
        if (tbody) {
            // Clear existing variable rows (keep add row)
            const rows = Array.from(tbody.querySelectorAll('tr:not(#scenario-add-row)'));
            rows.forEach(row => row.remove());
            
            // Add variable rows
            msg.variables.forEach(varData => {
                const tr = document.createElement('tr');
                
                // Column 1: Variable name
                const col1 = document.createElement('td');
                col1.textContent = '$' + varData.name;
                tr.appendChild(col1);
                
                // Column 2: Source select
                const col2 = document.createElement('td');
                const select = document.createElement('select');
                select.className = 'source-select';
                const optScenario = document.createElement('option');
                optScenario.value = 'scenario';
                optScenario.textContent = 'Scenario Context (Self)';
                optScenario.selected = varData.source === 'scenario';
                const optTemplate = document.createElement('option');
                optTemplate.value = 'template';
                optTemplate.textContent = 'Template Context';
                optTemplate.selected = varData.source === 'template';
                const optEnvironment = document.createElement('option');
                optEnvironment.value = 'environment';
                optEnvironment.textContent = 'Environment Context';
                optEnvironment.selected = varData.source === 'environment';
                select.appendChild(optScenario);
                select.appendChild(optTemplate);
                select.appendChild(optEnvironment);
                
                // Add other scenarios if available
                if (msg.otherScenarios) {
                    msg.otherScenarios.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = 'scenario:' + s;
                        opt.textContent = 'Scenario Context (' + s + ')';
                        opt.selected = varData.source === 'scenario:' + s;
                        select.appendChild(opt);
                    });
                }
                
                select.addEventListener('change', () => changeScenarioVariableSource(varData.name, select.value));
                col2.appendChild(select);
                tr.appendChild(col2);
                
                // Column 3: Value input
                const col3 = document.createElement('td');
                col3.className = 'value-cell';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = varData.value;
                input.addEventListener('blur', () => saveScenarioVariable(varData.name, input.value));
                col3.appendChild(input);
                tr.appendChild(col3);
                
                // Column 4: Delete button
                const col4 = document.createElement('td');
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-button';
                deleteBtn.textContent = 'Delete';
                deleteBtn.addEventListener('click', () => requestDelete('deleteScenarioVariable', varData.name));
                col4.appendChild(deleteBtn);
                tr.appendChild(col4);
                
                if (addRow) {
                    tbody.insertBefore(tr, addRow);
                } else {
                    tbody.appendChild(tr);
                }
            });
        }
    }
    
    if (msg.availableVariables) {
        const select = document.getElementById('scenario-add-name');
        if (select) {
            const firstOption = select.querySelector('option[value=""]');
            select.innerHTML = '';
            if (firstOption) {
                select.appendChild(firstOption);
            }
            msg.availableVariables.forEach(varName => {
                const option = document.createElement('option');
                option.value = varName;
                option.textContent = '$' + varName;
                select.appendChild(option);
            });
        }
    }
}

function hideVariableRowDOM(msg) {
    const row = document.querySelector(`tr[data-var="${msg.name}"]`);
    if (row) {
        row.style.display = 'none';
    }
}

function showVariableRowDOM(msg) {
    const row = document.querySelector(`tr[data-var="${msg.name}"]`);
    if (row) {
        row.style.display = '';
    }
}

function saveScrollState() {
    const state = {
        scrollPosition: window.scrollY || document.documentElement.scrollTop,
        activeTab: document.getElementById('template-tab').classList.contains('active') ? 'template' : 'environment'
    };
    vscode.setState(state);
}

function switchTab(tab) {
    
    saveScrollState();
    
    // Remove active class from all tabs and content
    const allTabs = document.querySelectorAll('.tab');
    const allContent = document.querySelectorAll('.tab-content');
    
    allTabs.forEach(t => {
        t.classList.remove('active');
    });
    allContent.forEach(t => {
        t.classList.remove('active');
    });
    
    // Add active class to selected tab and content
    const selector = `.tab[data-tab="${tab}"]`;
    const contentId = `${tab}-tab`;
    
    const selectedTab = document.querySelector(selector);
    const selectedContent = document.getElementById(contentId);
    
    
    if (selectedTab) {
        selectedTab.classList.add('active');
    } else {
        console.error('[switchTab] ✗ Could not find tab element!');
    }
    if (selectedContent) {
        selectedContent.classList.add('active');
    } else {
        console.error('[switchTab] ✗ Could not find content element!');
    }
    
    
    saveScrollState();
}

function loadEnvironmentContext() {
    vscode.postMessage({ command: 'loadEnvironmentContext' });
}

function changeTemplateContextFile() {
    vscode.postMessage({ command: 'changeTemplateContextFile' });
}

function reloadTemplateContext() {
    vscode.postMessage({ command: 'reloadTemplateContext' });
}

function saveEnvironmentContextAs() {
    vscode.postMessage({ command: 'saveEnvironmentContextAs' });
}

function promoteToEnvironment(itemType, name, objectName, propertyName, methodName) {
    vscode.postMessage({
        command: 'promoteToEnvironment',
        itemType,
        name,
        objectName,
        propertyName,
        methodName
    });
}

function saveValue(name, objectName, propertyName) {
    const inputId = objectName ? 'input-' + objectName + '-' + propertyName : 'input-' + name;
    const input = document.getElementById(inputId);
    if (!input) return;
    
    let value = input.value;
    try {
        value = JSON.parse(value);
    } catch (e) {
        // Keep as string if not valid JSON
    }
    
    if (objectName) {
        vscode.postMessage({ command: 'saveProperty', objectName, propertyName, value });
    } else {
        vscode.postMessage({ command: 'saveVariable', name, value });
    }
}

function saveMethod(objectName, methodName) {
    const textarea = document.getElementById('method-' + objectName + '-' + methodName);
    if (!textarea) return;
    
    vscode.postMessage({
        command: 'saveMethod',
        objectName,
        methodName,
        implementation: textarea.value
    });
}

function saveEnvironmentValue(name, objectName, propertyName) {
    const inputId = objectName ? 'ginput-' + objectName + '-' + propertyName : 'ginput-' + name;
    const input = document.getElementById(inputId);
    if (!input) return;
    
    let value = input.value;
    try {
        value = JSON.parse(value);
    } catch (e) {
        // Keep as string
    }
    
    if (objectName) {
        vscode.postMessage({ command: 'saveEnvironmentProperty', objectName, propertyName, value });
    } else {
        vscode.postMessage({ command: 'saveEnvironmentVariable', name, value });
    }
}

function saveEnvironmentMethod(objectName, methodName) {
    const textarea = document.getElementById('gmethod-' + objectName + '-' + methodName);
    if (!textarea) return;
    
    vscode.postMessage({
        command: 'saveEnvironmentMethod',
        objectName,
        methodName,
        implementation: textarea.value
    });
}

function saveEnvironmentConfig() {
    const messagesPath = document.getElementById('messagesPropertiesPath')?.value || '';
    const language = document.getElementById('language')?.value || 'en';
    
    vscode.postMessage({
        command: 'saveEnvironmentConfig',
        messagesPropertiesPath: messagesPath,
        language: language
    });
}

function browseForPropertiesFile() {
    vscode.postMessage({
        command: 'browsePropertiesFile'
    });
}

function browseMessagesFile() {
    vscode.postMessage({
        command: 'browseMessagesFile'
    });
}

function deleteMessagesFile(fileIndex) {
    vscode.postMessage({
        command: 'deleteMessagesFile',
        fileIndex: fileIndex
    });
}

function saveEnvironmentHeaderRow(oldName, part, value) {
    vscode.postMessage({
        command: 'saveEnvironmentHeaderRow',
        oldName: oldName,
        part: part,
        value: value
    });
}

function saveEnvironmentCspDirectiveRow(oldName, part, value) {
    vscode.postMessage({
        command: 'saveEnvironmentCspDirectiveRow',
        oldName: oldName,
        part: part,
        value: value
    });
}

function addScenarioHeader() {
    // Handle directly in frontend - no need to involve backend
    showNewRow({ type: 'scenarioHeader' });
}

function saveNewScenarioHeader() {
    const table = document.querySelector('.headers-table tbody');
    if (!table) return;
    
    const newRow = table.querySelector('tr.new-row');
    if (!newRow) return;
    
    const nameInput = newRow.querySelector('input[data-header-part="name"]');
    const valueInput = newRow.querySelector('input[data-header-part="value"]');
    
    vscode.postMessage({
        command: 'saveNewScenarioHeader',
        name: nameInput ? nameInput.value : '',
        value: valueInput ? valueInput.value : ''
    });
}

function cancelNewScenarioHeader() {
    // Handle directly in frontend - just remove the row
    removeNewRow({ type: 'scenarioHeader' });
}

function deleteScenarioHeader(name) {
    // Send to backend to update saved data
    vscode.postMessage({
        command: 'deleteScenarioHeader',
        name: name
    });
}

function addEnvironmentHeader() {
    // Handle directly in frontend - no need to involve backend
    showNewRow({ type: 'header' });
}

function saveNewEnvironmentHeader() {
    const row = document.querySelector('tr.header-row.new-row');
    if (!row) return;
    
    const nameInput = row.querySelector('input[data-header-part="name"]');
    const valueInput = row.querySelector('input[data-header-part="value"]');
    
    vscode.postMessage({
        command: 'saveNewEnvironmentHeader',
        name: nameInput ? nameInput.value : '',
        value: valueInput ? valueInput.value : ''
    });
}

function cancelNewEnvironmentHeader() {
    // Handle directly in frontend - just remove the row
    removeNewRow({ type: 'header' });
}

function deleteEnvironmentHeader(name) {
    // Send to backend to update saved data
    vscode.postMessage({
        command: 'deleteEnvironmentHeader',
        name: name
    });
}

function addEnvironmentCspDirective() {
    // Handle directly in frontend - no need to involve backend
    showNewRow({ type: 'cspDirective' });
}

function saveNewEnvironmentCspDirective() {
    const row = document.querySelector('tr.header-row.new-row[data-csp-directive="__new__"]');
    if (!row) return;
    
    const nameInput = row.querySelector('input[data-directive-part="name"]');
    const valueInput = row.querySelector('input[data-directive-part="value"]');
    
    vscode.postMessage({
        command: 'saveNewEnvironmentCspDirective',
        name: nameInput ? nameInput.value : '',
        value: valueInput ? valueInput.value : ''
    });
}

function cancelNewEnvironmentCspDirective() {
    // Handle directly in frontend - just remove the row
    removeNewRow({ type: 'cspDirective' });
}

function deleteEnvironmentCspDirective(name) {
    // Send to backend to update saved data
    vscode.postMessage({
        command: 'deleteEnvironmentCspDirective',
        name: name
    });
}

function reloadEnvironmentContext() {
    vscode.postMessage({
        command: 'reloadEnvironmentContext'
    });
}

function addEnvironmentVariable() {
    // Handle directly in frontend - no need to involve backend
    showNewRow({ type: 'variable' });
}

function saveNewEnvironmentVariable() {
    const row = document.querySelector('tr[data-variable-name="__new__"]');
    if (!row) return;
    
    const nameInput = row.querySelector('input[data-variable-part="name"]');
    const valueInput = row.querySelector('input[data-variable-part="value"]');
    
    vscode.postMessage({
        command: 'saveNewEnvironmentVariable',
        name: nameInput ? nameInput.value : '',
        value: valueInput ? valueInput.value : ''
    });
}

function cancelNewEnvironmentVariable() {
    // Handle directly in frontend - just remove the row
    removeNewRow({ type: 'variable' });
}

function deleteEnvironmentVariable(name) {
    // Send to backend to update saved data
    vscode.postMessage({
        command: 'deleteEnvironmentVariable',
        name: name
    });
}

function saveEnvironmentVariableRow(oldName, part, value) {
    vscode.postMessage({
        command: 'saveEnvironmentVariableRow',
        oldName: oldName,
        part: part,
        value: value
    });
}

function addEnvironmentMockFunction() {
    // Handle directly in frontend - no need to involve backend
    showNewRow({ type: 'mockFunction' });
}

function saveNewEnvironmentMockFunction() {
    const row = document.querySelector('tr[data-mock-name="__new__"]');
    if (!row) return;

    const implInput = row.querySelector('textarea');

    vscode.postMessage({
        command: 'saveNewEnvironmentMockFunction',
        implementation: implInput ? implInput.value : ''
    });
}

function cancelNewEnvironmentMockFunction() {
    removeNewRow({ type: 'mockFunction' });
}

function saveEnvironmentMockFunctionRow(oldName, implementation) {
    vscode.postMessage({
        command: 'saveEnvironmentMockFunctionRow',
        oldName: oldName,
        value: implementation
    });
}

function deleteEnvironmentMockFunction(name) {
    vscode.postMessage({
        command: 'deleteEnvironmentMockFunction',
        name: name
    });
}

function saveTemplateUrl() {
    const input = document.getElementById('template-url');
    const url = input.value;
    const scenario = input.getAttribute('data-scenario');
    vscode.postMessage({
        command: 'saveTemplateUrl',
        url,
        scenario
    });
}

function saveTemplateHeaders() {
    const headers = document.getElementById('template-headers').value;
    vscode.postMessage({
        command: 'saveTemplateHeaders',
        headers
    });
}

function saveHttpServletRequestVar(variable) {
    if (variable === undefined) {
        const select = document.getElementById('servlet-var-select');
        variable = select ? select.value : '';
    }
    vscode.postMessage({
        command: 'saveHttpServletRequestVar',
        variable
    });
}

function clearHttpServletRequestVar() {
    vscode.postMessage({
        command: 'clearHttpServletRequestVar'
    });
}

function saveLocaleVar(variable) {
    if (variable === undefined) {
        const select = document.getElementById('locale-var-select');
        variable = select ? select.value : '';
    }
    vscode.postMessage({
        command: 'setLocaleMapping',
        variable: variable || null
    });
}

function clearLocaleVar() {
    vscode.postMessage({
        command: 'setLocaleMapping',
        variable: null
    });
}

function saveMessagesVar(variable) {
    if (variable === undefined) {
        const select = document.getElementById('messages-var-select');
        variable = select ? select.value : '';
    }
    vscode.postMessage({
        command: 'setMessagesMapping',
        variable: variable || null
    });
}

function clearMessagesVar() {
    vscode.postMessage({
        command: 'setMessagesMapping',
        variable: null
    });
}

function switchScenario() {
    const select = document.getElementById('scenario-select');
    if (!select || !select.value) return;
    
    vscode.postMessage({
        command: 'switchScenario',
        scenario: select.value
    });
}

function createScenario() {
    vscode.postMessage({
        command: 'createScenario'
    });
}

function addScenario() {
    // Show inline row for adding new scenario
    showNewScenarioRow();
}

function saveNewScenario() {
    const table = document.querySelector('.scenarios-table tbody');
    if (!table) return;
    
    const newRow = table.querySelector('tr.new-row');
    if (!newRow) return;
    
    const nameInput = newRow.querySelector('input[data-scenario-part="name"]');
    
    vscode.postMessage({
        command: 'saveNewScenario',
        name: nameInput ? nameInput.value : ''
    });
}

function cancelNewScenario() {
    removeNewScenarioRow();
}

function deleteScenario() {
    const select = document.getElementById('scenario-select');
    if (!select || !select.value) return;
    
    vscode.postMessage({
        command: 'deleteScenario',
        scenario: select.value
    });
}

function deleteScenarioByName(name) {
    vscode.postMessage({
        command: 'deleteScenario',
        scenario: name
    });
}

function renameScenario() {
    const select = document.getElementById('scenario-select');
    if (!select || !select.value) return;
    
    vscode.postMessage({
        command: 'renameScenario',
        oldName: select.value
    });
}

function setScenarioInheritance() {
    const select = document.getElementById('inherit-from-select');
    if (!select) return;
    
    vscode.postMessage({
        command: 'setScenarioInheritance',
        inheritFrom: select.value
    });
}

function changeUrlSource(source) {
    // Update URL input disabled state
    const urlInput = document.getElementById('template-url');
    if (urlInput) {
        urlInput.disabled = (source !== 'self');
    }
    
    vscode.postMessage({
        command: 'changeUrlSource',
        source: source
    });
}

function saveScenarioUrl() {
    const input = document.getElementById('scenario-url');
    if (!input) return;
    
    vscode.postMessage({
        command: 'saveScenarioUrl',
        url: input.value.trim()
    });
}

function saveScenarioHeaders() {
    const textarea = document.getElementById('scenario-headers');
    if (!textarea) return;
    
    vscode.postMessage({
        command: 'saveScenarioHeaders',
        headers: textarea.value.trim()
    });
}

function saveScenarioVariable(name, value) {
    vscode.postMessage({
        command: 'saveScenarioVariable',
        name: name,
        value: value
    });
}

function addScenarioVariable() {
    // Request available variables from backend, then show inline row
    vscode.postMessage({
        command: 'getAvailableScenarioVariables'
    });
    // showNewRow will be called when backend responds with availableScenarioVariables
}

function deleteScenarioVariable(name) {
    vscode.postMessage({
        command: 'deleteScenarioVariable',
        name: name
    });
}

function saveNewScenarioVariable() {
    const row = document.querySelector('#scenario-variables-tbody tr[data-variable-name="__new__"]');
    if (!row) return;
    
    const nameField = row.querySelector('select[data-variable-part="name"], input[data-variable-part="name"]');
    const valueInput = row.querySelector('input[data-variable-part="value"]');
    const jsonCheckbox = row.querySelector('input[type="checkbox"][data-variable-part="json"]');
    const sourceSelect = row.querySelector('select[data-variable-part="source"]');
    
    vscode.postMessage({
        command: 'saveNewScenarioVariable',
        name: nameField ? nameField.value : '',
        value: valueInput && !valueInput.disabled ? valueInput.value : '',
        isJson: jsonCheckbox ? jsonCheckbox.checked : false,
        source: sourceSelect ? sourceSelect.value : 'self'
    });
}

function toggleScenarioVariableJson(name, isJson) {
    vscode.postMessage({
        command: 'toggleScenarioVariableJson',
        name: name,
        isJson: isJson
    });
}

function cancelNewScenarioVariable() {
    // Handle directly in frontend - just remove the row
    removeNewRow({ type: 'scenarioVariable' });
}

function addVariableToConfig() {
    const select = document.getElementById('add-variable-select');
    if (!select || !select.value) return;
    
    const [name, type] = select.value.split(':');
    vscode.postMessage({
        command: 'addVariableToConfig',
        name: name,
        type: type
    });
    select.value = '';
}

function saveEscapeVar(value) {
    vscode.postMessage({
        command: 'setEscapeMapping',
        variable: value || null
    });
}

function clearEscapeVar() {
    vscode.postMessage({
        command: 'setEscapeMapping',
        variable: null
    });
}

function setVariableSource(name, source) {
    vscode.postMessage({
        command: 'setVariableSource',
        name,
        source
    });
}

function setPropertySource(objectName, propertyName, source) {
    vscode.postMessage({
        command: 'setPropertySource',
        objectName,
        propertyName,
        source
    });
}

function setMethodSource(objectName, methodName, source) {
    vscode.postMessage({
        command: 'setMethodSource',
        objectName,
        methodName,
        source
    });
}

function showEnvironmentVariableAddRow() {
    const addRow = document.getElementById('environment-add-row');
    if (addRow) {
        addRow.style.display = '';
        document.getElementById('environment-add-name').focus();
    }
}

function hideEnvironmentVariableAddRow() {
    const addRow = document.getElementById('environment-add-row');
    if (addRow) {
        addRow.style.display = 'none';
        document.getElementById('environment-add-name').value = '';
        document.getElementById('environment-add-value').value = '';
    }
}

function confirmaddEnvironmentVariable() {
    const nameInput = document.getElementById('environment-add-name');
    const valueInput = document.getElementById('environment-add-value');
    if (!nameInput || !valueInput || !nameInput.value.trim()) return;
    
    vscode.postMessage({
        command: 'saveEnvironmentVariable',
        name: nameInput.value.trim(),
        value: valueInput.value
    });
    
    hideEnvironmentVariableAddRow();
}

function addEnvironmentVariableLegacy() {
    const nameInput = document.getElementById('add-environment-var-name');
    const valueInput = document.getElementById('add-environment-var-value');
    if (!nameInput || !valueInput || !nameInput.value.trim()) return;
    
    vscode.postMessage({
        command: 'saveEnvironmentVariable',
        name: nameInput.value.trim(),
        value: valueInput.value
    });
    
    nameInput.value = '';
    valueInput.value = '';
}

function saveEnvironmentVariableValue(name, value) {
    vscode.postMessage({
        command: 'saveEnvironmentVariable',
        name: name,
        value: value
    });
}

function deleteEnvironmentVariableLegacy(name) {
    vscode.postMessage({
        command: 'requestDeleteConfirm',
        message: 'Delete environment variable $' + name + '?',
        deleteCommand: 'deleteEnvironmentVariable',
        name: name
    });
}

function showTemplateVariableAddRow() {
    const addRow = document.getElementById('template-add-row');
    if (addRow) {
        addRow.style.display = '';
        document.getElementById('template-add-name').focus();
    }
}

function hideTemplateVariableAddRow() {
    const addRow = document.getElementById('template-add-row');
    if (addRow) {
        addRow.style.display = 'none';
        document.getElementById('template-add-name').value = '';
        document.getElementById('template-add-value').value = '';
    }
}

function confirmAddTemplateVariable() {
    const nameSelect = document.getElementById('template-add-name');
    const sourceSelect = document.getElementById('template-add-source');
    const valueInput = document.getElementById('template-add-value');
    if (!nameSelect || !sourceSelect || !valueInput || !nameSelect.value) return;
    
    const [name, type] = nameSelect.value.split(':');
    vscode.postMessage({
        command: 'addVariableToConfig',
        name: name,
        type: type,
        source: sourceSelect.value,
        value: valueInput.value
    });
    
    hideTemplateVariableAddRow();
}

function changeTemplateVariableSource(name, source) {
    vscode.postMessage({
        command: 'changeTemplateVariableSource',
        name: name,
        source: source
    });
}

function saveTemplateVariableValue(name, value) {
    vscode.postMessage({
        command: 'saveVariable',
        name: name,
        value: value
    });
}

function deleteTemplateVariable(name) {
    vscode.postMessage({
        command: 'requestDeleteConfirm',
        message: 'Delete variable $' + name + '?',
        deleteCommand: 'deleteVariable',
        name: name
    });
}

function changeTemplatePropertySource(objectName, propertyName, source) {
    vscode.postMessage({
        command: 'changeTemplatePropertySource',
        objectName: objectName,
        propertyName: propertyName,
        source: source
    });
}

function saveTemplatePropertyValue(objectName, propertyName, value) {
    vscode.postMessage({
        command: 'saveProperty',
        objectName: objectName,
        propertyName: propertyName,
        value: value
    });
}

function deleteTemplateProperty(objectName, propertyName) {
    vscode.postMessage({
        command: 'requestDeleteConfirm',
        message: 'Delete property $' + objectName + '.' + propertyName + '?',
        deleteCommand: 'deleteProperty',
        objectName: objectName,
        propertyName: propertyName
    });
}

function changeTemplateMethodSource(objectName, methodName, source) {
    vscode.postMessage({
        command: 'changeTemplateMethodSource',
        objectName: objectName,
        methodName: methodName,
        source: source
    });
}

function saveTemplateMethodImpl(objectName, methodName, implementation) {
    vscode.postMessage({
        command: 'saveMethod',
        objectName: objectName,
        methodName: methodName,
        implementation: implementation
    });
}

function deleteTemplateMethod(objectName, methodName) {
    vscode.postMessage({
        command: 'requestDeleteConfirm',
        message: 'Delete method $' + objectName + '.' + methodName + '()?',
        deleteCommand: 'deleteMethod',
        objectName: objectName,
        methodName: methodName
    });
}

function showScenarioVariableAddRow() {
    const addRow = document.getElementById('scenario-add-row');
    if (addRow) {
        addRow.style.display = '';
        document.getElementById('scenario-add-name').focus();
    }
}

function hideScenarioVariableAddRow() {
    const addRow = document.getElementById('scenario-add-row');
    if (addRow) {
        addRow.style.display = 'none';
        document.getElementById('scenario-add-name').value = '';
        document.getElementById('scenario-add-value').value = '';
    }
}

function confirmAddScenarioVariable() {
    const nameSelect = document.getElementById('scenario-add-name');
    const sourceSelect = document.getElementById('scenario-add-source');
    const valueInput = document.getElementById('scenario-add-value');
    if (!nameSelect || !sourceSelect || !valueInput || !nameSelect.value) return;
    
    vscode.postMessage({
        command: 'addScenarioVariableWithSource',
        name: nameSelect.value,
        source: sourceSelect.value,
        value: valueInput.value
    });
    
    hideScenarioVariableAddRow();
}

function changeScenarioVariableSource(name, source) {
    vscode.postMessage({
        command: 'changeScenarioVariableSource',
        name: name,
        source: source
    });
}

function saveMethodMapping(method, mappedTo) {
    vscode.postMessage({
        command: 'saveMethodMapping',
        method: method,
        mappedTo: mappedTo
    });
}

function showNewScenarioRow() {
    // Find the scenarios table
    const table = document.querySelector('.scenarios-table tbody');
    if (!table) {
        console.error('Could not find scenarios table tbody');
        return;
    }
    
    // Disable Add button
    const addButtons = document.querySelectorAll('.add-table-row-button[data-action="addScenario"]');
    addButtons.forEach(btn => btn.disabled = true);
    
    // Create new row
    const newRow = document.createElement('tr');
    newRow.className = 'header-row editing new-row';
    newRow.innerHTML = `
        <td></td>
        <td>
            <input type="text" class="header-cell-input" value="" data-scenario-part="name" placeholder="Scenario name" />
        </td>
        <td style="text-align: center;">
            <button class="icon-button save-new-row" data-action="saveNewScenario" title="Save"><span class="codicon codicon-check"></span></button>
            <button class="icon-button" data-action="cancelNewScenario" title="Cancel"><span class="codicon codicon-close"></span></button>
        </td>
    `;
    
    // Insert before the "Add" button row
    const addRow = table.querySelector('.add-row');
    if (addRow) {
        table.insertBefore(newRow, addRow);
    } else {
        table.appendChild(newRow);
    }
    
    // Focus the input
    setTimeout(() => {
        const nameInput = newRow.querySelector('input[data-scenario-part="name"]');
        if (nameInput) {
            nameInput.focus();
        }
    }, 50);
}

function removeNewScenarioRow() {
    const table = document.querySelector('.scenarios-table tbody');
    if (!table) return;
    
    const newRow = table.querySelector('tr.new-row');
    if (newRow) {
        newRow.remove();
    }
    
    // Re-enable Add button
    const addButtons = document.querySelectorAll('.add-table-row-button[data-action="addScenario"]');
    addButtons.forEach(btn => btn.disabled = false);
}

function showNewRow(message) {
    if (message.type === 'header') {
        // Find the headers table specifically
        const container = document.getElementById('environment-headers-table');
        if (!container) {
            console.error('Could not find environment-headers-table container');
            return;
        }
        const table = container.querySelector('.headers-table tbody');
        if (!table) {
            console.error('Could not find headers table tbody');
            return;
        }
        
        // Disable Add button
        const addButton = document.getElementById('add-environment-header-btn');
        if (addButton) {
            addButton.disabled = true;
        }
        
        // Create new row
        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.innerHTML = `
            <td data-action="editHeaderCell" data-header-part="name">
                <input type="text" class="header-cell-input" value="" data-header-part="name" placeholder="Header name" />
            </td>
            <td data-action="editHeaderCell" data-header-part="value">
                <input type="text" class="header-cell-input" value="" data-header-part="value" placeholder="Header value" />
            </td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewEnvironmentHeader" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewEnvironmentHeader" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;
        
        // Insert before the "Add" button row
        const addRow = table.querySelector('.add-row');
        if (addRow) {
            table.insertBefore(newRow, addRow);
        } else {
            table.appendChild(newRow);
        }
        
        // Focus the first input
        setTimeout(() => {
            const firstInput = newRow.querySelector('input[data-header-part="name"]');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
        
    } else if (message.type === 'scenarioHeader') {
        // Find the scenario headers table specifically
        const tbody = document.getElementById('scenario-headers-tbody');
        if (!tbody) {
            console.error('Could not find scenario-headers-tbody');
            return;
        }
        
        // Disable Add button
        const addButtons = document.querySelectorAll('.add-table-row-button[data-action="addScenarioHeader"]');
        addButtons.forEach(btn => btn.disabled = true);
        
        // Create new row
        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.innerHTML = `
            <td data-action="editHeaderCell" data-header-part="name">
                <input type="text" class="header-cell-input" value="" data-header-part="name" placeholder="Header name" />
            </td>
            <td data-action="editHeaderCell" data-header-part="value">
                <input type="text" class="header-cell-input" value="" data-header-part="value" placeholder="Header value" />
            </td>
            <td></td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewScenarioHeader" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewScenarioHeader" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;
        
        // Insert before the "Add" button row
        const addRow = tbody.querySelector('.add-row');
        if (addRow) {
            tbody.insertBefore(newRow, addRow);
        } else {
            tbody.appendChild(newRow);
        }
        
        // Focus the first input
        setTimeout(() => {
            const firstInput = newRow.querySelector('input[data-header-part="name"]');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
        
    } else if (message.type === 'cspDirective') {
        // Find the CSP directives table specifically
        const container = document.getElementById('environment-csp-directives-table');
        if (!container) {
            console.error('Could not find environment-csp-directives-table container');
            return;
        }
        const table = container.querySelector('.headers-table tbody');
        if (!table) {
            console.error('Could not find CSP directives table tbody');
            return;
        }
        
        // Disable Add button
        const addButton = document.getElementById('add-environment-csp-directive-btn');
        if (addButton) {
            addButton.disabled = true;
        }
        
        // Create new row
        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.setAttribute('data-csp-directive', '__new__');
        newRow.innerHTML = `
            <td data-action="editCspDirectiveCell" data-directive-part="name">
                <input type="text" class="header-cell-input" value="" data-directive-part="name" placeholder="e.g., default-src, script-src" />
            </td>
            <td data-action="editCspDirectiveCell" data-directive-part="value">
                <input type="text" class="header-cell-input" value="" data-directive-part="value" placeholder="e.g., 'self' 'unsafe-inline'" />
            </td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewEnvironmentCspDirective" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewEnvironmentCspDirective" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;
        
        // Insert before the "Add" button row
        const addRow = table.querySelector('.add-row');
        if (addRow) {
            table.insertBefore(newRow, addRow);
        } else {
            table.appendChild(newRow);
        }
        
        // Focus the first input
        setTimeout(() => {
            const firstInput = newRow.querySelector('input[data-directive-part="name"]');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
        
    } else if (message.type === 'variable') {
        // Find the variables table specifically
        const container = document.getElementById('environment-variables-table');
        if (!container) {
            console.error('Could not find environment-variables-table container');
            return;
        }
        const table = container.querySelector('.headers-table tbody');
        if (!table) {
            console.error('Could not find variables table tbody');
            return;
        }
        
        // Disable Add button
        const addButton = document.getElementById('add-environment-variable-btn');
        if (addButton) {
            addButton.disabled = true;
        }
        
        // Create new row
        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.setAttribute('data-variable-name', '__new__');
        newRow.innerHTML = `
            <td data-action="editVariableCell" data-variable-part="name">
                <input type="text" class="header-cell-input" value="" data-variable-part="name" placeholder="Variable name" />
            </td>
            <td data-action="editVariableCell" data-variable-part="value">
                <input type="text" class="header-cell-input" value="" data-variable-part="value" placeholder="Variable value" />
            </td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewEnvironmentVariable" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewEnvironmentVariable" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;
        
        // Insert before the "Add" button row
        const addRow = table.querySelector('.add-row');
        if (addRow) {
            table.insertBefore(newRow, addRow);
        } else {
            table.appendChild(newRow);
        }
        
        // Focus the first input
        setTimeout(() => {
            const firstInput = newRow.querySelector('input[data-variable-part="name"]');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
    } else if (message.type === 'mockFunction') {
        const container = document.getElementById('environment-mock-functions-table');
        if (!container) {
            console.error('Could not find environment-mock-functions-table container');
            return;
        }
        const table = container.querySelector('.headers-table tbody');
        if (!table) {
            console.error('Could not find mock functions table tbody');
            return;
        }

        const addButton = document.getElementById('add-environment-mock-function-btn');
        if (addButton) {
            addButton.disabled = true;
        }

        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.setAttribute('data-mock-name', '__new__');
        newRow.innerHTML = `
            <td data-action="editMockFunctionCell">
                <textarea class="mock-implementation-input" placeholder="function myFunction(args) {\n  return args[0];\n}"></textarea>
            </td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewEnvironmentMockFunction" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewEnvironmentMockFunction" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;

        const addRow = table.querySelector('.add-row');
        if (addRow) {
            table.insertBefore(newRow, addRow);
        } else {
            table.appendChild(newRow);
        }

        setTimeout(() => {
            const textarea = newRow.querySelector('textarea');
            if (textarea) {
                textarea.focus();
            }
        }, 50);
    } else if (message.type === 'scenarioVariable') {
        const tbody = document.getElementById('scenario-variables-tbody');
        if (!tbody) {
            console.error('Could not find scenario-variables-tbody');
            return;
        }
        
        const addButton = tbody.querySelector('button[data-action="addScenarioVariable"]');
        if (addButton) addButton.disabled = true;
        
        const availableVars = message.availableVariables || [];
        const otherScenarios = message.scenarios || []; // [{ name, variables[] }]

        // Map: varName -> array of scenario names that define it
        const varScenarioMap = {};
        otherScenarios.forEach(sc => {
            sc.variables.forEach(vn => {
                if (!varScenarioMap[vn]) varScenarioMap[vn] = [];
                varScenarioMap[vn].push(sc.name);
            });
        });

        // Name field
        let nameFieldHtml;
        if (availableVars.length > 0) {
            const options = availableVars.map(varName =>
                `<option value="${escapeHtml(varName)}">${escapeHtml(varName)}</option>`
            ).join('');
            nameFieldHtml = `
                <select class="header-cell-input" data-variable-part="name">
                    <option value="">-- Select Variable --</option>
                    ${options}
                </select>
            `;
        } else {
            nameFieldHtml = `
                <input type="text" class="header-cell-input" value="" data-variable-part="name" placeholder="Variable name" />
            `;
        }

        // Source dropdown — starts with only "Self"; options added dynamically on name change
        const newRow = document.createElement('tr');
        newRow.className = 'header-row editing new-row';
        newRow.setAttribute('data-variable-name', '__new__');
        newRow.innerHTML = `
            <td data-action="editVariableCell" data-variable-part="name">
                ${nameFieldHtml}
            </td>
            <td data-action="editVariableCell" data-variable-part="value">
                <input type="text" class="header-cell-input" value="" data-variable-part="value" placeholder="Variable value" />
            </td>
            <td style="text-align:center;">
                <input type="checkbox" title="Parse value as JSON array/object" data-variable-part="json" />
            </td>
            <td>
                <select data-variable-part="source" class="scenario-source-select">
                    <option value="self">Self</option>
                </select>
            </td>
            <td>
                <button class="icon-button save-new-row" data-action="saveNewScenarioVariable" title="Save"><span class="codicon codicon-check"></span></button>
                <button class="icon-button" data-action="cancelNewScenarioVariable" title="Cancel"><span class="codicon codicon-close"></span></button>
            </td>
        `;
        
        const addRow = tbody.querySelector('.add-row');
        if (addRow) tbody.insertBefore(newRow, addRow);
        else tbody.appendChild(newRow);
        
        const nameSelect = newRow.querySelector('select[data-variable-part="name"], input[data-variable-part="name"]');
        const sourceSelect = newRow.querySelector('select[data-variable-part="source"]');
        const valueInput = newRow.querySelector('input[data-variable-part="value"]');

        function updateSourceOptions() {
            if (!sourceSelect) return;
            const selectedVar = nameSelect ? nameSelect.value : '';

            // Remove all non-'self' options
            Array.from(sourceSelect.options).forEach(opt => {
                if (opt.value !== 'self') opt.remove();
            });

            // Add options for scenarios that define this variable with source='self'
            const scenariosForVar = varScenarioMap[selectedVar] || [];
            scenariosForVar.forEach(scenarioName => {
                const opt = document.createElement('option');
                opt.value = scenarioName;
                opt.textContent = scenarioName;
                sourceSelect.appendChild(opt);
            });

            // Always reset to 'Self' when variable changes
            sourceSelect.value = 'self';
            updateValueInput();
        }

        function updateValueInput() {
            if (!valueInput || !sourceSelect) return;
            const isSelf = sourceSelect.value === 'self';
            valueInput.disabled = !isSelf;
            valueInput.placeholder = isSelf ? 'Variable value' : '(inherited from scenario)';
            if (isSelf) {
                valueInput.classList.remove('scenario-var-inherited');
            } else {
                valueInput.classList.add('scenario-var-inherited');
                valueInput.value = '';
            }
            const jsonCheckbox = newRow.querySelector('input[type="checkbox"][data-variable-part="json"]');
            if (jsonCheckbox) {
                jsonCheckbox.disabled = !isSelf;
                if (!isSelf) jsonCheckbox.checked = false;
            }
        }

        if (nameSelect) {
            nameSelect.addEventListener('change', updateSourceOptions);
            // Also handle 'input' for the text-input fallback (fires as user types)
            nameSelect.addEventListener('input', updateSourceOptions);
        }
        if (sourceSelect) sourceSelect.addEventListener('change', updateValueInput);
        updateSourceOptions();

        setTimeout(() => { if (nameSelect) nameSelect.focus(); }, 50);
    }
}

function removeNewRow(message) {
    if (message.type === 'header') {
        const row = document.querySelector('tr.header-row.new-row');
        if (row) {
            row.remove();
        }
        // Re-enable the Add button
        const addButton = document.getElementById('add-environment-header-btn');
        if (addButton) {
            addButton.disabled = false;
        }
    } else if (message.type === 'scenarioHeader') {
        const newRow = document.querySelector('#scenario-headers-tbody tr.new-row');
        if (newRow) {
            newRow.remove();
        }
        // Re-enable Add button
        const addButtons = document.querySelectorAll('.add-table-row-button[data-action="addScenarioHeader"]');
        addButtons.forEach(btn => btn.disabled = false);
    } else if (message.type === 'cspDirective') {
        const row = document.querySelector('tr[data-csp-directive="__new__"]');
        if (row) {
            row.remove();
        }
        // Re-enable the Add button
        const addButton = document.getElementById('add-environment-csp-directive-btn');
        if (addButton) {
            addButton.disabled = false;
        }
    } else if (message.type === 'variable') {
        const row = document.querySelector('tr[data-variable-name="__new__"]');
        if (row) {
            row.remove();
        }
        // Re-enable the Add button
        const addButton = document.getElementById('add-environment-variable-btn');
        if (addButton) {
            addButton.disabled = false;
        }
    } else if (message.type === 'mockFunction') {
        const row = document.querySelector('tr[data-mock-name="__new__"]');
        if (row) {
            row.remove();
        }
        const addButton = document.getElementById('add-environment-mock-function-btn');
        if (addButton) {
            addButton.disabled = false;
        }
    } else if (message.type === 'scenarioVariable') {
        const row = document.querySelector('#scenario-variables-tbody tr[data-variable-name="__new__"]');
        if (row) {
            row.remove();
        }
        // Re-enable the Add button
        const addButton = document.querySelector('#scenario-variables-tbody button[data-action="addScenarioVariable"]');
        if (addButton) {
            addButton.disabled = false;
        }
    }
}

function showRowError(message) {
    // Create error notification
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        padding: 12px 16px;
        border-radius: 4px;
        max-width: 400px;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message.message;
    document.body.appendChild(errorDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        errorDiv.remove();
    }, 5000);
    
    // Re-focus the row that has the error
    if (message.type === 'header') {
        const row = document.querySelector(`tr[data-header-name="${message.rowId}"]`);
        if (row) {
            row.classList.add('editing');
            const firstEmptyInput = row.querySelector('.header-cell-input[value=""]');
            if (firstEmptyInput) {
                firstEmptyInput.focus();
            }
        }
    } else if (message.type === 'variable') {
        const row = document.querySelector(`tr[data-variable-name="${message.rowId}"]`);
        if (row) {
            row.classList.add('editing');
            const firstEmptyInput = row.querySelector('.header-cell-input[value=""]');
            if (firstEmptyInput) {
                firstEmptyInput.focus();
            }
        }
    } else if (message.type === 'mockFunction') {
        const row = document.querySelector(`tr[data-mock-name="${message.rowId}"]`);
        if (row) {
            row.classList.add('editing');
            const textarea = row.querySelector('textarea');
            if (textarea) {
                textarea.focus();
            }
        }
    }
}

function upsertEnvironmentHeaderRowDOM(msg) {
    const container = document.getElementById('environment-headers-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;

    const name = msg.name || '';
    const value = msg.value !== undefined ? String(msg.value) : '';
    const oldName = msg.oldName || '';

    const newRow = tbody.querySelector('tr.header-row.new-row');
    if (newRow) {
        newRow.remove();
        const addButton = document.getElementById('add-environment-header-btn');
        if (addButton) addButton.disabled = false;
    }

    let row = null;
    if (oldName) {
        row = tbody.querySelector(`tr[data-header-name="${cssEscape(oldName)}"]`);
    }
    if (!row) {
        row = tbody.querySelector(`tr[data-header-name="${cssEscape(name)}"]`);
    }

    if (!row) {
        row = document.createElement('tr');
        row.className = 'header-row';
        row.innerHTML = `
            <td data-action="editHeaderCell" data-header-name="${escapeHtml(name)}" data-header-part="name">
                <span class="header-cell-value">${escapeHtml(name)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(name)}" data-old-name="${escapeHtml(name)}" data-header-part="name" data-action="saveEnvironmentHeaderRow" />
            </td>
            <td data-action="editHeaderCell" data-header-name="${escapeHtml(name)}" data-header-part="value">
                <span class="header-cell-value">${escapeHtml(value)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(value)}" data-old-name="${escapeHtml(name)}" data-header-part="value" data-action="saveEnvironmentHeaderRow" />
            </td>
            <td><button class="delete" data-action="deleteEnvironmentHeader" data-name="${escapeHtml(name)}" title="Delete">🗑</button></td>
        `;
        row.setAttribute('data-header-name', name);
        const addRow = tbody.querySelector('.add-row');
        if (addRow) {
            tbody.insertBefore(row, addRow);
        } else {
            tbody.appendChild(row);
        }
    } else {
        row.setAttribute('data-header-name', name);
        row.querySelectorAll('[data-header-part="name"]').forEach(cell => {
            cell.setAttribute('data-header-name', name);
        });
        row.querySelectorAll('input[data-header-part="name"]').forEach(input => {
            input.value = name;
            input.setAttribute('data-old-name', name);
        });
        row.querySelectorAll('input[data-header-part="value"]').forEach(input => {
            input.value = value;
            input.setAttribute('data-old-name', name);
        });
        const nameSpan = row.querySelector('td[data-header-part="name"] .header-cell-value');
        if (nameSpan) nameSpan.textContent = name;
        const valueSpan = row.querySelector('td[data-header-part="value"] .header-cell-value');
        if (valueSpan) valueSpan.textContent = value;
        const deleteBtn = row.querySelector('button[data-action="deleteEnvironmentHeader"]');
        if (deleteBtn) deleteBtn.setAttribute('data-name', name);
    }
}

function deleteEnvironmentHeaderRowDOM(msg) {
    const container = document.getElementById('environment-headers-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;
    const name = msg.name || '';
    const row = tbody.querySelector(`tr[data-header-name="${cssEscape(name)}"]`);
    if (row) row.remove();
}

function upsertEnvironmentCspDirectiveRowDOM(msg) {
    const container = document.getElementById('environment-csp-directives-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;

    const name = msg.name || '';
    const value = msg.value !== undefined ? String(msg.value) : '';
    const oldName = msg.oldName || '';

    const newRow = tbody.querySelector('tr.header-row.new-row[data-csp-directive="__new__"]');
    if (newRow) {
        newRow.remove();
        const addButton = document.getElementById('add-environment-csp-directive-btn');
        if (addButton) addButton.disabled = false;
    }

    let row = null;
    if (oldName) {
        row = tbody.querySelector(`tr[data-csp-directive="${cssEscape(oldName)}"]`);
    }
    if (!row) {
        row = tbody.querySelector(`tr[data-csp-directive="${cssEscape(name)}"]`);
    }

    if (!row) {
        row = document.createElement('tr');
        row.className = 'header-row';
        row.innerHTML = `
            <td data-action="editCspDirectiveCell" data-directive-name="${escapeHtml(name)}" data-directive-part="name">
                <span class="header-cell-value">${escapeHtml(name)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(name)}" data-old-name="${escapeHtml(name)}" data-directive-part="name" data-action="saveEnvironmentCspDirectiveRow" placeholder="e.g., default-src, script-src" />
            </td>
            <td data-action="editCspDirectiveCell" data-directive-name="${escapeHtml(name)}" data-directive-part="value">
                <span class="header-cell-value">${escapeHtml(value)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(value)}" data-old-name="${escapeHtml(name)}" data-directive-part="value" data-action="saveEnvironmentCspDirectiveRow" placeholder="e.g., 'self' 'unsafe-inline'" />
            </td>
            <td><button class="delete" data-action="deleteEnvironmentCspDirective" data-name="${escapeHtml(name)}" title="Delete">🗑</button></td>
        `;
        row.setAttribute('data-csp-directive', name);
        const addRow = tbody.querySelector('.add-row');
        if (addRow) {
            tbody.insertBefore(row, addRow);
        } else {
            tbody.appendChild(row);
        }
    } else {
        row.setAttribute('data-csp-directive', name);
        row.querySelectorAll('[data-directive-part="name"]').forEach(cell => {
            cell.setAttribute('data-directive-name', name);
        });
        row.querySelectorAll('input[data-directive-part="name"]').forEach(input => {
            input.value = name;
            input.setAttribute('data-old-name', name);
        });
        row.querySelectorAll('input[data-directive-part="value"]').forEach(input => {
            input.value = value;
            input.setAttribute('data-old-name', name);
        });
        const nameSpan = row.querySelector('td[data-directive-part="name"] .header-cell-value');
        if (nameSpan) nameSpan.textContent = name;
        const valueSpan = row.querySelector('td[data-directive-part="value"] .header-cell-value');
        if (valueSpan) valueSpan.textContent = value;
        const deleteBtn = row.querySelector('button[data-action="deleteEnvironmentCspDirective"]');
        if (deleteBtn) deleteBtn.setAttribute('data-name', name);
    }
}

function deleteEnvironmentCspDirectiveRowDOM(msg) {
    const container = document.getElementById('environment-csp-directives-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;
    const name = msg.name || '';
    const row = tbody.querySelector(`tr[data-csp-directive="${cssEscape(name)}"]`);
    if (row) row.remove();
}

function upsertEnvironmentVariableRowDOM(msg) {
    const container = document.getElementById('environment-variables-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;

    const name = msg.name || '';
    const value = msg.value !== undefined ? String(msg.value) : '';
    const oldName = msg.oldName || '';

    const newRow = tbody.querySelector('tr[data-variable-name="__new__"]');
    if (newRow) {
        newRow.remove();
        const addButton = document.getElementById('add-environment-variable-btn');
        if (addButton) addButton.disabled = false;
    }

    let row = null;
    if (oldName) {
        row = tbody.querySelector(`tr[data-variable-name="${cssEscape(oldName)}"]`);
    }
    if (!row) {
        row = tbody.querySelector(`tr[data-variable-name="${cssEscape(name)}"]`);
    }

    if (!row) {
        row = document.createElement('tr');
        row.className = 'variable-row';
        row.setAttribute('data-variable-name', name);
        row.innerHTML = `
            <td data-action="editVariableCell" data-variable-part="name">
                <span class="header-cell-value">${escapeHtml(name)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(name)}" data-variable-part="name" data-action="saveEnvironmentVariableRow" />
            </td>
            <td data-action="editVariableCell" data-variable-part="value">
                <span class="header-cell-value">${escapeHtml(value)}</span>
                <input type="text" class="header-cell-input" value="${escapeHtml(value)}" data-variable-part="value" data-action="saveEnvironmentVariableRow" />
            </td>
            <td><button class="delete" data-action="deleteEnvironmentVariable" data-variable-name="${escapeHtml(name)}" title="Delete">🗑</button></td>
        `;
        const addRow = tbody.querySelector('.add-row');
        if (addRow) {
            tbody.insertBefore(row, addRow);
        } else {
            tbody.appendChild(row);
        }
    } else {
        row.setAttribute('data-variable-name', name);
        const nameSpan = row.querySelector('td[data-variable-part="name"] .header-cell-value');
        if (nameSpan) nameSpan.textContent = name;
        const valueSpan = row.querySelector('td[data-variable-part="value"] .header-cell-value');
        if (valueSpan) valueSpan.textContent = value;
        row.querySelectorAll('input[data-variable-part="name"]').forEach(input => {
            input.value = name;
        });
        row.querySelectorAll('input[data-variable-part="value"]').forEach(input => {
            input.value = value;
        });
        const deleteBtn = row.querySelector('button[data-action="deleteEnvironmentVariable"]');
        if (deleteBtn) deleteBtn.setAttribute('data-variable-name', name);
    }
}

function deleteEnvironmentVariableRowDOM(msg) {
    const container = document.getElementById('environment-variables-table');
    if (!container) return;
    const tbody = container.querySelector('.headers-table tbody');
    if (!tbody) return;
    const name = msg.name || '';
    const row = tbody.querySelector(`tr[data-variable-name="${cssEscape(name)}"]`);
    if (row) row.remove();
}

function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
}








