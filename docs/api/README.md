# Declaration baseline

core.api.txt is generated from the emitted entry point and its reachable declaration modules.
It is a review trigger, not a semantic-version oracle. Some module-internal declarations appear;
only the root package exports are supported. No deep imports are promised.

Run npm run check:api to compare; after intentional public changes, review compatibility and
run npm run api:update. Both compilers exercise the frozen packed consumer fixture independently.
Do not refresh the baseline merely to make CI green. The first baseline is pre-release 0.0.0,
not evidence that a previously published stable version existed.
