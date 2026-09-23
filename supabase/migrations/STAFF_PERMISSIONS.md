# Staff accounts and permissions

The admin-only Staff Delegation tab displays **Users & Permissions**. It lists all
existing user profiles, including accounts without delegations. Those accounts show
**No Permissions Assigned** and their existing role defaults.

Admin is the only administrator role and always has full access. The admin account
cannot be restricted or deactivated from this tab. The admin can create staff
accounts and edit, deactivate, or restore access for non-admin accounts.

## Setup

1. Apply `20260922_staff_permissions.sql` after the existing migrations through
   `20260921_order_group_discounts.sql` in the project's Supabase SQL Editor.
2. Apply `20260924_single_admin.sql`. It preserves Supply Chain checkbox selections
   and converts accounts using the obsolete administrator tier back to `admin`.
   It works directly after `20260922_staff_permissions.sql` or after the former
   hierarchy migration. Sign out and back in after converting an account's role.
3. Apply `20260925_role_presets.sql` for Secretary/Agent creation and atomic role/permission edits.
4. Apply `20260926_admin_creation_tags.sql` to restrict admin creation to the verified
   `admin@example.com` administrator account.
5. Redeploy the included account service with
   `supabase functions deploy create-staff-user` to the same Supabase project.
   It uses the hosted function's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   Never put the service role key in a frontend environment variable.

The migration extends `delegations`, adds admin-only permission management, and
enforces warehouse restrictions with database policies and permission checks in
the existing order and movement transactions. Existing stock and financial
calculations are preserved. Selected warehouse access requires every warehouse in
an order or internal transfer to be allowed; records with unknown warehouse scope
are hidden from users with selected access.

Supply Chain uses independent Customers, Suppliers, and Warehouses checkboxes.
View All selects all three; leaving all unchecked means no Supply Chain access.
Warehouse scope is separate: it limits warehouse data in enabled inventory,
orders, item entry, and Supply Chain views. Selecting warehouses never enables a
disabled module. Staff Supply Chain permissions remain view-only.

Account creation uses Supabase Auth and creates a `staff` profile and delegation.
Only the verified `admin@example.com` administrator may create additional admin accounts.
Other admins can create Secretary, Agent, and Staff accounts.
It does not change the signed-in administrator's session. The initial password
must have at least 12 characters. If profile provisioning fails, the service
attempts to remove only the newly created Auth login and reports any cleanup error.

Deactivation retains the user and historical records, blocks operational access,
and preserves saved permissions for the admin to review before restoring access.
The user can still sign in and access Settings. Deactivated accounts are available
under the status filter. Pricelists retain the existing local-storage persistence;
this change controls the existing editor and does not introduce a new pricelist store.

## Checks

Run `npm run lint`, `npm run build`, and
`node --import tsx --test src/lib/staffPermissions.test.ts`.
Verify account creation and database policies in a configured Supabase environment
after applying the migration and deploying the function.

## Role presets

Selecting Secretary or Agent fills in suggested module permissions in the account
editor. Secretary starts with inventory adjustment, order creation, both movement
types, all Supply Chain views, and pricelist viewing. Agent starts with inventory
and pricelist viewing, order creation, customer viewing, and no movement access.
New accounts initially use the Agent preset. Admin is selectable for new accounts only when signed in as `admin@example.com`.
Admin accounts retain full access; custom permissions apply to non-admin accounts.

The admin can override any suggested module setting or restrict the user to one
or more warehouses. Changing the role keeps the current warehouse selection.
Opening an existing account preserves saved overrides; presets are reapplied only
when the admin changes the role. Saving persists the role and permission overrides
in one database transaction. The user's profile role refreshes on their next sign-in.

## Role tags and filtering

The user list displays the saved account role as a tag. The role-tag dropdown
filters Admin, Secretary, Agent, or existing Staff accounts and combines with the
name/email/role search and account-status filter. The account service checks the
verified Auth email, and database provisioning and profile-write guards enforce
the designated-admin creation rule independently of the UI.
