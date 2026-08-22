# SURAKSHA HUB — Attendance & Wage Tracker

This is the standalone Angular frontend for the attendance app. It shares the existing Sync Point Supabase project and uses the same `public.users` custom authentication.

## One-time database setup

Run [008_attendance_maintenance.sql](../SurakshaChat/Sync%20Point/syncpoint/supabase/migrations/008_attendance_maintenance.sql) in the Supabase Dashboard SQL Editor after the existing Sync Point migrations. The migration creates employee, attendance, payment, and FIFO allocation tables, plus transactional payment and reversal RPCs. It also marks the existing `pradeep` account as an attendance admin.

The app cannot apply DDL remotely because the browser only uses the Supabase anon key. Do not put a service-role key in this frontend.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.1.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Business rules implemented

- Attendance starts as pending and only approved records earn money.
- Full day, half day, and leave use the historical rate stored on each record.
- Payments are validated against outstanding earnings and allocated FIFO in one database transaction.
- Payment history is preserved; reversal marks a payment reversed and restores its outstanding amounts.
- Attendance payment status is derived independently from approval status.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
