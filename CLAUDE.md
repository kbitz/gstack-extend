# Native Interaction Runtime

Native macOS app interaction and QA via Peekaboo CLI.

## Testing

Run the validation gates:

```bash
./scripts/validate.sh
```

To test against a specific app:

```bash
./scripts/validate.sh --app "MyApp"
```

To run a single gate:

```bash
./scripts/validate.sh --gate 1  # AX Tree Quality
./scripts/validate.sh --gate 2  # Interaction Reliability
./scripts/validate.sh --gate 3  # 20-Step Reliability Proof
./scripts/validate.sh --gate 4  # Latency
```

## Native App

Configure these for build integration:

```yaml
native_app_bundle_id: ""
native_app_scheme: ""
# native_workspace_path: ""
# native_build_configuration: "Debug"
# native_launch_args: ""
# native_build_timeout: 120
```
