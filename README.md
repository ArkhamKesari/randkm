var UserDashboardAjax = Class.create();

UserDashboardAjax.prototype = Object.extendsObject(
    global.AbstractAjaxProcessor, {

    // Initial version: administrators only.
    isPublic: function () {
        return false;
    },

    _allowed: function () {
        return gs.hasRole('admin');
    },

    _error: function (message) {
        return {
            ok: false,
            error: message
        };
    },

    // Read a field only when the caller can read it.
    _read: function (gr, field, display) {
        if (!gr.isValidField(field) ||
            !gr.getElement(field).canRead()) {
            return null;
        }

        return String(
            (display ?
                gr.getDisplayValue(field) :
                gr.getValue(field)) || ''
        );
    },

    // Return display values and their underlying raw values.
    _record: function (gr, fields) {
        var row = {
            id: String(gr.getUniqueValue())
        };

        for (var i = 0; i < fields.length; i++) {
            row[fields[i]] =
                this._read(gr, fields[i], true);

            row['raw_' + fields[i]] =
                this._read(gr, fields[i], false);
        }

        return row;
    },

    _table: function (name, fields) {
        var gr = new GlideRecordSecure(name);

        if (!gr.isValid()) {
            throw new Error('Table unavailable: ' + name);
        }

        for (var i = 0; i < fields.length; i++) {
            if (!gr.isValidField(fields[i])) {
                throw new Error(
                    'Missing field: ' +
                    name + '.' + fields[i]
                );
            }
        }

        return gr;
    },

    _failure: function (name, error) {
        gs.error(
            '[UserDashboard] ' +
            name + ': ' + String(error)
        );

        return this._error(
            'Unavailable. Check record access, ' +
            'application scope permissions and the system log.'
        );
    },

    // General reader used by the dashboard sections.
    // Table names and filters come from this script,
    // not from browser-supplied queries.
    _list: function (table, filters, fields, order, limit) {
        try {
            limit = limit || 100;

            var gr = this._table(table, fields);

            for (var i = 0; i < filters.length; i++) {
                var f = filters[i];

                if (!gr.isValidField(f[0])) {
                    throw new Error('Invalid filter field');
                }

                // Never run an unrestricted query for an empty ID list.
                if (f[1] === 'IN' && !f[2]) {
                    return {
                        ok: true,
                        rows: [],
                        more: false,
                        note: ''
                    };
                }

                gr.addQuery(f[0], f[1], f[2]);
            }

            gr.orderBy(order || 'sys_id');

            if (order && order !== 'sys_id') {
                gr.orderBy('sys_id');
            }

            gr.setLimit(limit + 1);
            gr.query();

            var rows = [];
            var more = false;

            while (gr.next()) {
                if (!gr.canRead()) {
                    continue;
                }

                // Do not expose a relationship through an unreadable field.
                for (var j = 0; j < filters.length; j++) {
                    if (this._read(
                        gr, filters[j][0], false
                    ) === null) {
                        throw new Error(
                            'Relationship field is unreadable'
                        );
                    }
                }

                if (rows.length === limit) {
                    more = true;
                    break;
                }

                rows.push(this._record(gr, fields));
            }

            return {
                ok: true,
                rows: rows,
                more: more,
                note: ''
            };

        } catch (e) {
            return this._failure(table, e);
        }
    },

    // Collect distinct readable reference IDs.
    _ids: function (section, field) {
        var ids = [];
        var seen = {};

        if (!section.ok) {
            return ids;
        }

        for (var i = 0; i < section.rows.length; i++) {
            var id = section.rows[i]['raw_' + field];

            if (id &&
                /^[0-9a-f]{32}$/i.test(id) &&
                !seen[id]) {

                seen[id] = true;
                ids.push(id);
            }
        }

        return ids;
    },

    // Read records linked to a previously loaded section.
    _related: function (
        source, key, table, filter, fields
    ) {
        if (!source.ok) {
            return this._error(
                'The source relationship section could not load.'
            );
        }

        var ids = key === 'id' ?
            [] : this._ids(source, key);

        if (key === 'id') {
            for (var i = 0; i < source.rows.length; i++) {
                ids.push(source.rows[i].id);
            }
        }

        var result = this._list(
            table,
            [[filter, 'IN', ids.join(',')]],
            fields
        );

        if (result.ok) {
            result.note =
                'Based on the readable source entries shown above; ' +
                'source limits and access restrictions also apply here.';
        }

        return result;
    },

    // Called when the user searches by name or User ID.
    searchUsers: function () {
        if (!this._allowed()) {
            return JSON.stringify(this._error(
                'This dashboard requires the admin role.'
            ));
        }

        try {
            var term = String(
                this.getParameter('sysparm_term') || ''
            ).replace(/^\s+|\s+$/g, '');

            if (term.length > 120) {
                return JSON.stringify(this._error(
                    'Use 120 characters or fewer.'
                ));
            }

            var gr = this._table(
                'sys_user',
                ['name', 'user_name']
            );

            if (term) {
                gr.addQuery(
                    'name', 'CONTAINS', term
                ).addOrCondition(
                    'user_name', 'CONTAINS', term
                );
            }

            gr.orderBy('name');
            gr.orderBy('sys_id');
            gr.setLimit(26);
            gr.query();

            var rows = [];
            var more = false;

            while (gr.next()) {
                if (!gr.canRead()) {
                    continue;
                }

                if (this._read(gr, 'name', false) === null ||
                    this._read(gr, 'user_name', false) === null) {
                    continue;
                }

                if (rows.length === 25) {
                    more = true;
                    break;
                }

                rows.push(this._record(
                    gr, ['name', 'user_name']
                ));
            }

            return JSON.stringify({
                ok: true,
                rows: rows,
                more: more
            });

        } catch (e) {
            return JSON.stringify(
                this._failure('Search', e)
            );
        }
    },

    // Build parent paths in batches.
    // Used for both reporting and territory hierarchy.
    _paths: function (ids, table, parentField, fields) {
        try {
            var roots = [];
            var seenRoots = {};
            var i;

            for (i = 0; i < ids.length; i++) {
                if (!seenRoots[ids[i]]) {
                    seenRoots[ids[i]] = true;
                    roots.push(ids[i]);
                }
            }

            var capped = roots.length > 25;
            roots = roots.slice(0, 25);

            var frontier = roots.slice(0);
            var cache = {};
            var attempted = {};

            for (
                var depth = 0;
                frontier.length && depth < 12;
                depth++
            ) {
                var batch = this._list(
                    table,
                    [['sys_id', 'IN', frontier.join(',')]],
                    fields
                );

                if (!batch.ok) {
                    return batch;
                }

                for (i = 0; i < frontier.length; i++) {
                    attempted[frontier[i]] = true;
                }

                var next = [];
                var queued = {};

                for (i = 0; i < batch.rows.length; i++) {
                    var item = batch.rows[i];
                    cache[item.id] = item;

                    var parent = item['raw_' + parentField];

                    if (parent &&
                        /^[0-9a-f]{32}$/i.test(parent) &&
                        !attempted[parent] &&
                        !queued[parent]) {

                        queued[parent] = true;
                        next.push(parent);
                    }
                }

                frontier = next;
            }

            var rows = [];

            for (i = 0; i < roots.length; i++) {
                var id = roots[i];
                var visited = {};
                var labels = [];
                var status = 'Complete';

                while (id && labels.length < 12) {
                    if (visited[id]) {
                        status = 'Cycle detected';
                        break;
                    }

                    visited[id] = true;

                    var current = cache[id];

                    if (!current) {
                        status =
                            'Partial: unavailable record or depth limit';
                        break;
                    }

                    labels.unshift(
                        current.name === null ?
                            'Unavailable' :
                            (current.name || '(unnamed)')
                    );

                    id = current['raw_' + parentField];

                    if (id === null) {
                        status = 'Partial: parent field unavailable';
                        break;
                    }
                }

                if (id && status === 'Complete') {
                    status = 'Partial: depth limit';
                }

                var root = cache[roots[i]];

                rows.push({
                    id: roots[i],
                    name: root ? root.name : null,
                    path: labels.join(' → '),
                    status: status
                });
            }

            return {
                ok: true,
                rows: rows,
                more: capped,
                note:
                    'Root first. Up to 25 starting records and ' +
                    '12 parent levels. Ancestors are context only.'
            };

        } catch (e) {
            return this._failure('Hierarchy', e);
        }
    },

    // Called when a user is selected or refreshed.
    getDashboard: function () {
        if (!this._allowed()) {
            return JSON.stringify(this._error(
                'This dashboard requires the admin role.'
            ));
        }

        try {
            var id = String(
                this.getParameter('sysparm_user_id') || ''
            );

            if (!/^[0-9a-f]{32}$/i.test(id)) {
                return JSON.stringify(this._error(
                    'Invalid user ID.'
                ));
            }

            var profile = this._list(
                'sys_user',
                [['sys_id', '=', id]],
                [
                    'name', 'user_name', 'email', 'title',
                    'department', 'manager', 'active'
                ],
                null,
                1
            );

            if (!profile.ok || !profile.rows.length) {
                return JSON.stringify(this._error(
                    'User unavailable or not permitted.'
                ));
            }

            var s = {};

            s.roles = this._list(
                'sys_user_has_role',
                [['user', '=', id]],
                ['role', 'inherited', 'state'],
                'role'
            );

            s.groups = this._list(
                'sys_user_grmember',
                [['user', '=', id]],
                ['group'],
                'group'
            );

            s.memberships = this._list(
                'sn_tp_territory_membership_override',
                [['user', '=', id]],
                [
                    'territory', 'membershiptype',
                    'active', 'from', 'to'
                ],
                'territory'
            );

            s.responsibilities = this._related(
                s.memberships,
                'id',
                'sn_tp_crm_extn_territory_membership_responsibility',
                'territory_membership',
                [
                    'territory_membership',
                    'member_role',
                    'responsibility'
                ]
            );

            // Add the territory name to each responsibility row.
            if (s.responsibilities.ok && s.memberships.ok) {
                var byMembership = {};

                for (
                    var m = 0;
                    m < s.memberships.rows.length;
                    m++
                ) {
                    byMembership[s.memberships.rows[m].id] =
                        s.memberships.rows[m];
                }

                for (
                    var r = 0;
                    r < s.responsibilities.rows.length;
                    r++
                ) {
                    var row = s.responsibilities.rows[r];

                    var membership =
                        byMembership[row.raw_territory_membership];

                    row.territory = membership ?
                        membership.territory : null;
                }
            }

            s.managed = this._list(
                'sn_tp_territory_manager',
                [['manager', '=', id]],
                [
                    'territory', 'manager_type',
                    'primary', 'from', 'to'
                ],
                'territory'
            );

            s.groupTerritories = this._related(
                s.groups,
                'group',
                'sn_tp_territory_group',
                'group',
                [
                    'group', 'territory',
                    'membershiptype', 'active'
                ]
            );

            s.accountTeam = this._list(
                'sn_customerservice_team_member',
                [['user', '=', id]],
                ['account', 'type', 'responsibility'],
                'order'
            );

            s.ownedAccounts = this._list(
                'customer_account',
                [['sales_owner', '=', id]],
                ['name', 'number', 'primary_sales_territory'],
                'name'
            );

            s.reports = this._list(
                'sys_user',
                [['manager', '=', id]],
                ['name', 'user_name', 'title', 'active'],
                'name'
            );

            s.reporting = this._paths(
                [id],
                'sys_user',
                'manager',
                ['name', 'manager']
            );

            var territoryIds = this._ids(
                s.memberships, 'territory'
            ).concat(
                this._ids(s.managed, 'territory'),
                this._ids(s.groupTerritories, 'territory')
            );

            if (!s.memberships.ok &&
                !s.managed.ok &&
                !s.groupTerritories.ok) {

                s.hierarchy = this._error(
                    'Territory relationship sections could not load.'
                );

            } else {
                s.hierarchy = this._paths(
                    territoryIds,
                    'sn_tp_territory',
                    'parent',
                    ['name', 'parent']
                );

                if (s.hierarchy.ok) {
                    s.hierarchy.note +=
                        ' Based on the readable membership, ' +
                        'manager and group links shown.';
                }
            }

            return JSON.stringify({
                ok: true,
                user: profile.rows[0],
                sections: s
            });

        } catch (e) {
            return JSON.stringify(
                this._failure('Dashboard', e)
            );
        }
    },

    type: 'UserDashboardAjax'
});