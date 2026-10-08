# Changelog

## [0.2.0](https://github.com/prokolyvakis/wrapp-sdk/compare/wrapp-sdk-v0.1.0...wrapp-sdk-v0.2.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* **invoices:** CreateInvoiceInput['invoice_type_code'] gains fifteen members, and CreateInvoiceInput['counterpart'] is optional in the type. Exhaustive switches and Record maps over the union need the new cases; code that reads counterpart from an input value must handle undefined. Every type except 6.1, 6.2 and 8.6 still requires a counterpart at run time.
* **invoices:** CreateInvoiceInput['invoice_type_code'] gains nine members. Code that switches exhaustively over the union, or maps it with a Record, needs the new cases.
* invoices.getStatus returns a tagged observed | pending outcome; pending outcomes carry identity; VerifiedWebhook kinds are renamed to invoice-observation, pdf and pos-payment-error; create rejects VAT rates, quantity types, exemption codes and exchange-rate precision outside the documented sets; known full-detail fields with an unexpected type now fail the read. See docs/migration.md.

### Features

* add billing-book number update, PDF locale, catering transfer ([4769903](https://github.com/prokolyvakis/wrapp-sdk/commit/4769903c16bb082a8412a8f1ab5b000acf82397c))
* add branch create and update and billing-book create ([79c9054](https://github.com/prokolyvakis/wrapp-sdk/commit/79c9054c494dfe7fbbffaf3a807742d745905794))
* add catering tables and order-note operations ([7a18eec](https://github.com/prokolyvakis/wrapp-sdk/commit/7a18eec144faca61ca17e72acd14b086285cde51))
* add digital clientele correlations ([38d9d61](https://github.com/prokolyvakis/wrapp-sdk/commit/38d9d617972023cf66ed2e635e6805bde16b552d))
* add digital transports with opaque provider evidence ([dbe5b74](https://github.com/prokolyvakis/wrapp-sdk/commit/dbe5b74513c235807d055d488b08e0ac1b1e0988))
* add POS devices, session abort and invoice POS fields ([f6e0173](https://github.com/prokolyvakis/wrapp-sdk/commit/f6e01734358e2c769f05f629c5e472b529610b63))
* correct core invoice flows, pending outcomes and webhook events ([2b87e9b](https://github.com/prokolyvakis/wrapp-sdk/commit/2b87e9b19d732827a5d5f7bf8fa1c623a9cd5c42))
* **invoices:** accept B2G invoice fields ([035700e](https://github.com/prokolyvakis/wrapp-sdk/commit/035700e29a7a18b7fa28728adcf24e75ceb7fcbd))
* **invoices:** accept delivery-note fields on supported types ([e628413](https://github.com/prokolyvakis/wrapp-sdk/commit/e628413bd319c4f36cd22d6f18fc365387e8ddcf))
* **invoices:** accept fifteen more invoice types ([4a86286](https://github.com/prokolyvakis/wrapp-sdk/commit/4a86286c06d9231532ba70d4df4485377ed31b02))
* **invoices:** accept fuel invoice fields ([dc63f12](https://github.com/prokolyvakis/wrapp-sdk/commit/dc63f12660c8b008a784bdcda6706c3bc3eb403c))
* **invoices:** accept general invoice and line request fields ([4593a18](https://github.com/prokolyvakis/wrapp-sdk/commit/4593a18d0c362591a6c71fc8f1ede47b36ad9689))
* **invoices:** accept nine more invoice types ([c9cd09e](https://github.com/prokolyvakis/wrapp-sdk/commit/c9cd09e3dface2d4f1a0100f245532dd7747847f))
* **invoices:** add cancellation, reference, payment, draft calls ([bfb75e7](https://github.com/prokolyvakis/wrapp-sdk/commit/bfb75e77fedbf50cfd5f13bd5f467f51ce6c21f3))
* **invoices:** add thermal PDF request, issued count, type catalogue ([aa67ebc](https://github.com/prokolyvakis/wrapp-sdk/commit/aa67ebc45d5029d71e970242f33631bd2e3add81))
* **invoices:** return seven more full-detail fields ([55d2b53](https://github.com/prokolyvakis/wrapp-sdk/commit/55d2b53c2cb4a78e1b11e034bc09b42398d64d7b))
* **invoices:** save, issue and list drafts ([86b5811](https://github.com/prokolyvakis/wrapp-sdk/commit/86b581131790a3ebf57574da80cf5b42232a9323))
* read, create, update and cancel clientele entries ([8317ea8](https://github.com/prokolyvakis/wrapp-sdk/commit/8317ea8b76345c448224f3fdfb4e5650badb1d2b))


### Bug Fixes

* **invoices:** accept null and sparse fields on full-detail reads ([a083063](https://github.com/prokolyvakis/wrapp-sdk/commit/a083063b3d8831e19a43bee9d16c0fbe75e63420))
* issue drafts by reference and expect the transfer's target table ([256e020](https://github.com/prokolyvakis/wrapp-sdk/commit/256e020ab021c2ee2303837c2a90e112685ec40c))

## 0.1.0 (2026-09-22)


### Features

* add Wrapp core SDK ([ed1357a](https://github.com/prokolyvakis/wrapp-sdk/commit/ed1357a03144a247dc28190570d056b82a77c7a2))
* harden parsing and origins, surface rejection evidence ([9af88b3](https://github.com/prokolyvakis/wrapp-sdk/commit/9af88b303912ee242eb105dcb6e58d6533735780))


### Bug Fixes

* **codecs:** align the observation profile with live staging evidence ([606eda6](https://github.com/prokolyvakis/wrapp-sdk/commit/606eda631336449f491029d0c809ba6db1b302c0))
* **codecs:** match rejection envelope statuses case-insensitively ([a4d15bd](https://github.com/prokolyvakis/wrapp-sdk/commit/a4d15bd22490b3315dd13883462fc59909283281))
* **scripts:** make consumer check survive a fresh CI runner ([30d69f8](https://github.com/prokolyvakis/wrapp-sdk/commit/30d69f85fc7b6d6c927681d04ba271608a83fcc2))
* **tooling:** widen secret-scan coverage and harden repo gates ([5d6b80f](https://github.com/prokolyvakis/wrapp-sdk/commit/5d6b80fb7abf1672d09cc8d7ca07a4264ec86533))
