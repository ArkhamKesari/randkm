(function () {

    function start() {
        var root = document.getElementById('ud');

        if (!root ||
            root.getAttribute('data-ready') === 'true') {
            return;
        }

        root.setAttribute('data-ready', 'true');

        // Must match your Script Include's API Name.
        var AJAX_NAME =
            'sn_sales_territory.UserDashboardAjax';

        var state = {
            selected: '',
            searchVersion: 0,
            detailVersion: 0
        };

        function el(id) {
            return document.getElementById('ud-' + id);
        }

        function value(v) {
            if (v === null || v === undefined) {
                return 'Unavailable';
            }

            return v === '' ? 'Not set' : String(v);
        }

        // Use textContent to display record values as text.
        function node(tag, content, cls) {
            var n = document.createElement(tag);

            if (content !== undefined) {
                n.textContent = value(content);
            }

            if (cls) {
                n.className = cls;
            }

            return n;
        }

        function clear(n) {
            while (n.firstChild) {
                n.removeChild(n.firstChild);
            }
        }

        function status(id, message, error) {
            el(id).textContent = message;
            el(id).className =
                error ? 'ud-error' : 'ud-muted';
        }

        function bool(v) {
            if (v === 'true' || v === '1') {
                return 'Yes';
            }

            if (v === 'false' || v === '0') {
                return 'No';
            }

            return value(v);
        }

        function url(table, id) {
            return '/' + table +
                '.do?sys_id=' + encodeURIComponent(id);
        }

        function openLink(table, id) {
            var a = node('a', 'Open');

            a.href = url(table, id);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';

            return a;
        }

        // Send a request to the Script Include.
        function request(method, params, done) {
            var settled = false;

            var timer = setTimeout(function () {
                finish({
                    ok: false,
                    error: 'Request timed out. Try again.'
                });
            }, 30000);

            function finish(result) {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);
                done(result);
            }

            try {
                var ga = new GlideAjax(AJAX_NAME);

                ga.addParam('sysparm_name', method);

                for (var key in params) {
                    if (Object.prototype.hasOwnProperty.call(
                        params, key
                    )) {
                        ga.addParam(key, params[key]);
                    }
                }

                ga.getXMLAnswer(function (answer) {
                    var result;

                    try {
                        result = JSON.parse(answer || 'null');

                        if (!result ||
                            typeof result.ok !== 'boolean') {
                            throw new Error('Invalid response');
                        }

                    } catch (e) {
                        result = {
                            ok: false,
                            error:
                                'Invalid response. Check the API Name, ' +
                                'Client callable setting, ACLs and system log.'
                        };
                    }

                    finish(result);
                });

            } catch (e) {
                finish({
                    ok: false,
                    error:
                        'Unable to send request. ' +
                        'Check the Script Include configuration.'
                });
            }
        }

        function markSelection() {
            var buttons = el('users').querySelectorAll(
                'button[data-id]'
            );

            for (var i = 0; i < buttons.length; i++) {
                buttons[i].setAttribute(
                    'aria-pressed',
                    buttons[i].getAttribute('data-id') ===
                        state.selected ? 'true' : 'false'
                );
            }
        }

        function search() {
            var version = ++state.searchVersion;

            el('search').disabled = true;
            status('search-status', 'Searching...');

            request(
                'searchUsers',
                { sysparm_term: el('query').value },

                function (r) {
                    if (version !== state.searchVersion) {
                        return;
                    }

                    el('search').disabled = false;
                    clear(el('users'));

                    if (!r.ok) {
                        status('search-status', r.error, true);
                        return;
                    }

                    status(
                        'search-status',
                        r.more ?
                            'First 25 users shown. Refine your search.' :
                            r.rows.length + ' readable users shown.'
                    );

                    r.rows.forEach(function (user) {
                        var button = node(
                            'button', user.name, 'ud-user'
                        );

                        button.type = 'button';
                        button.setAttribute('data-id', user.id);

                        button.appendChild(
                            node('span', user.user_name)
                        );

                        button.addEventListener(
                            'click',
                            function () {
                                select(user.id);
                            }
                        );

                        el('users').appendChild(button);
                    });

                    markSelection();
                }
            );
        }

        // Each column:
        // [heading, response field, optional 'bool']
        var sections = [
            {
                key: 'roles',
                title: 'Security roles',
                table: 'sys_user_has_role',
                note:
                    'Recorded role assignments, including inherited ' +
                    'status and state. This is not an ' +
                    'effective-permissions calculation.',
                columns: [
                    ['Role', 'role'],
                    ['Inherited', 'inherited', 'bool'],
                    ['State', 'state']
                ]
            },
            {
                key: 'groups',
                title: 'Group memberships',
                table: 'sys_user_grmember',
                note:
                    'Groups linked directly to the selected user.',
                columns: [
                    ['Group', 'group']
                ]
            },
            {
                key: 'reporting',
                title: 'Reporting hierarchy',
                table: 'sys_user',
                wide: true,
                note:
                    'Manager chain ending with the selected user.',
                columns: [
                    ['User', 'name'],
                    ['Reporting path', 'path'],
                    ['Path status', 'status']
                ]
            },
            {
                key: 'reports',
                title: 'Direct reports',
                table: 'sys_user',
                wide: true,
                note:
                    'Users whose Manager field points to ' +
                    'the selected user.',
                columns: [
                    ['Name', 'name'],
                    ['User ID', 'user_name'],
                    ['Title', 'title'],
                    ['Active', 'active', 'bool']
                ]
            },
            {
                key: 'memberships',
                title: 'Direct territory membership records',
                table: 'sn_tp_territory_membership_override',
                wide: true,
                note:
                    'Includes active, inactive, future and expired ' +
                    'records. Review the active flag and membership dates.',
                columns: [
                    ['Territory', 'territory'],
                    ['Membership type', 'membershiptype'],
                    ['Active', 'active', 'bool'],
                    ['From', 'from'],
                    ['To', 'to']
                ]
            },
            {
                key: 'responsibilities',
                title: 'Territory responsibilities',
                table:
                    'sn_tp_crm_extn_territory_membership_responsibility',
                wide: true,
                note:
                    'Business member roles and responsibilities linked ' +
                    'to the direct membership records above.',
                columns: [
                    ['Territory', 'territory'],
                    ['Member role', 'member_role'],
                    ['Responsibility', 'responsibility']
                ]
            },
            {
                key: 'managed',
                title: 'Territory manager assignments',
                table: 'sn_tp_territory_manager',
                wide: true,
                note:
                    'Stored territory manager records. ' +
                    'Review their date ranges.',
                columns: [
                    ['Territory', 'territory'],
                    ['Manager type', 'manager_type'],
                    ['Primary', 'primary', 'bool'],
                    ['From', 'from'],
                    ['To', 'to']
                ]
            },
            {
                key: 'groupTerritories',
                title: 'Territories linked through groups',
                table: 'sn_tp_territory_group',
                wide: true,
                note:
                    'Territory-group links for the user\'s groups. ' +
                    'These links alone do not establish ' +
                    'effective territory access.',
                columns: [
                    ['Group', 'group'],
                    ['Territory', 'territory'],
                    ['Membership type', 'membershiptype'],
                    ['Active', 'active', 'bool']
                ]
            },
            {
                key: 'hierarchy',
                title: 'Territory hierarchy',
                table: 'sn_tp_territory',
                wide: true,
                note:
                    'Parent paths for territories in the membership, ' +
                    'manager and group sections. Ancestors are ' +
                    'not extra user assignments.',
                columns: [
                    ['Territory', 'name'],
                    ['Territory path', 'path'],
                    ['Path status', 'status']
                ]
            },
            {
                key: 'accountTeam',
                title: 'Account-team assignments',
                table: 'sn_customerservice_team_member',
                wide: true,
                note:
                    'Each row is one account-team entry. A user can ' +
                    'have several responsibilities on the same account.',
                columns: [
                    ['Account', 'account'],
                    ['Type', 'type'],
                    ['Responsibility', 'responsibility']
                ]
            },
            {
                key: 'ownedAccounts',
                title: 'Accounts owned as sales owner',
                table: 'customer_account',
                wide: true,
                note:
                    'Accounts whose Sales Owner field points to this ' +
                    'user. These can overlap with account-team assignments.',
                columns: [
                    ['Account', 'name'],
                    ['Number', 'number'],
                    ['Account primary territory', 'primary_sales_territory']
                ]
            }
        ];

        // Build one dashboard panel and its table.
        function renderSection(config, result) {
            var box = node(
                'section',
                undefined,
                'ud-card' + (config.wide ? ' ud-wide' : '')
            );

            box.appendChild(node('h2', config.title));
            box.appendChild(node('p', config.note, 'ud-muted'));
            el('sections').appendChild(box);

            if (!result || !result.ok) {
                box.appendChild(node(
                    'p',
                    result ? result.error : 'Unavailable',
                    'ud-error'
                ));
                return;
            }

            box.appendChild(node(
                'p',
                result.rows.length + ' entries shown',
                'ud-muted'
            ));

            if (!result.rows.length) {
                box.appendChild(node(
                    'p', 'No readable entries returned.'
                ));

            } else {
                var wrap = node(
                    'div', undefined, 'ud-table'
                );

                var table = node('table');
                var head = node('thead');
                var heading = node('tr');
                var body = node('tbody');

                table.setAttribute('aria-label', config.title);

                config.columns.concat([
                    ['Record']
                ]).forEach(function (col) {
                    var th = node('th', col[0]);
                    th.scope = 'col';
                    heading.appendChild(th);
                });

                head.appendChild(heading);
                table.appendChild(head);

                result.rows.forEach(function (row) {
                    var tr = node('tr');

                    config.columns.forEach(function (col) {
                        var content = col[2] === 'bool' ?
                            bool(row['raw_' + col[1]]) :
                            row[col[1]];

                        tr.appendChild(node('td', content));
                    });

                    var td = node('td');
                    td.appendChild(
                        openLink(config.table, row.id)
                    );

                    tr.appendChild(td);
                    body.appendChild(tr);
                });

                table.appendChild(body);
                wrap.appendChild(table);
                box.appendChild(wrap);
            }

            if (result.more) {
                box.appendChild(node(
                    'p',
                    'Display limit reached. ' +
                    'Additional records are not shown.',
                    'ud-note'
                ));
            }

            if (result.note) {
                box.appendChild(node(
                    'p', result.note, 'ud-muted'
                ));
            }
        }

        // Populate the profile, cards and tables.
        function render(r) {
            var u = r.user;
            var s = r.sections;

            el('name').textContent = value(u.name);
            el('open-user').href = url('sys_user', u.id);

            clear(el('profile'));

            [
                ['User ID', u.user_name],
                ['Email', u.email],
                ['Title', u.title],
                ['Department', u.department],
                ['Manager', u.manager],
                ['Active', bool(u.raw_active)]

            ].forEach(function (field) {
                el('profile').appendChild(
                    node('dt', field[0])
                );

                el('profile').appendChild(
                    node('dd', field[1])
                );
            });

            clear(el('metrics'));

            [
                ['Roles shown', 'roles'],
                ['Group entries shown', 'groups'],
                ['Memberships shown', 'memberships'],
                ['Account-team entries shown', 'accountTeam']

            ].forEach(function (metric) {
                var result = s[metric[1]];

                var card = node(
                    'div', undefined, 'ud-card ud-metric'
                );

                card.appendChild(node(
                    'span', metric[0], 'ud-muted'
                ));

                card.appendChild(node(
                    'strong',
                    result && result.ok ?
                        String(result.rows.length) :
                        'Unavailable'
                ));

                if (result && result.ok && result.more) {
                    card.appendChild(node(
                        'span',
                        'Additional entries not shown',
                        'ud-muted'
                    ));
                }

                el('metrics').appendChild(card);
            });

            clear(el('sections'));

            sections.forEach(function (config) {
                renderSection(config, s[config.key]);
            });
        }

        // Load a selected user's dashboard.
        function select(id) {
            state.selected = id;
            markSelection();

            var version = ++state.detailVersion;

            el('refresh').disabled = true;
            el('main').setAttribute('aria-busy', 'true');
            el('detail').hidden = true;

            status('status', 'Loading user dashboard...');

            request(
                'getDashboard',
                { sysparm_user_id: id },

                function (r) {
                    // Ignore an older response after another user is selected.
                    if (version !== state.detailVersion) {
                        return;
                    }

                    el('refresh').disabled = false;
                    el('main').setAttribute('aria-busy', 'false');

                    if (!r.ok) {
                        status('status', r.error, true);
                        return;
                    }

                    try {
                        render(r);

                    } catch (e) {
                        status(
                            'status',
                            'Could not display the response. ' +
                            'Check that all three code sections ' +
                            'use the same version.',
                            true
                        );
                        return;
                    }

                    el('detail').hidden = false;

                    var partial = sections.some(function (config) {
                        return !r.sections[config.key] ||
                            !r.sections[config.key].ok;
                    });

                    status(
                        'status',
                        partial ?
                            'Loaded with some sections unavailable. ' +
                            'See the messages below.' :
                            'User dashboard loaded.',
                        partial
                    );
                }
            );
        }

        el('search').addEventListener('click', search);

        el('query').addEventListener(
            'keydown',
            function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    search();
                }
            }
        );

        el('refresh').addEventListener(
            'click',
            function () {
                if (state.selected) {
                    select(state.selected);
                }
            }
        );

        search();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

})();