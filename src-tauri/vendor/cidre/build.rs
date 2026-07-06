use std::{
    env,
    fs::{self, read_to_string},
    path::{Path, PathBuf},
    process::Command,
    str::FromStr,
};

#[derive(Debug, Clone, Copy)]
struct Version {
    major: u32,
    minor: u32,
}

#[derive(Debug, Clone, Default)]
struct DeploymentTargets {
    macos: String,
    ios: String,
    tvos: String,
    watchos: String,
    visionos: String,
}

impl Version {
    fn with_table(table: &[(String, Self)]) -> Option<Self> {
        for record in table {
            if env::var_os(&record.0).is_some() {
                return Some(record.1);
            }
        }
        None
    }

    fn with_str(str: &str) -> Option<Self> {
        let mut res = Self { major: 0, minor: 0 };
        let mut iter = str.split("_").into_iter();
        let Some(s) = iter.next() else {
            return None;
        };

        res.major = str::parse(s).unwrap();

        let Some(s) = iter.next() else {
            return None;
        };

        res.minor = str::parse(s).unwrap();

        Some(res)
    }

    fn to_string(&self) -> String {
        format!("{}.{}", self.major, self.minor)
    }
}

fn add_xc_target_args_from_features(
    target_args: &mut Vec<&'static str>,
    features: &[&'static str],
) {
    for feature in features {
        let env_var = format!("CARGO_FEATURE_{}", feature.to_uppercase());
        if env::var_os(env_var).is_some() {
            target_args.push("-target");
            target_args.push(feature);
        }
    }
}

fn xc_build(
    targets: &[&'static str],
    sdk: &str,
    arch: &str,
    configuration: &str,
    deployment_targets: &DeploymentTargets,
) {
    let mut out_lib_dir = PathBuf::from(&env::var("OUT_DIR").unwrap());
    let mut env_args = Vec::with_capacity(6);
    if !deployment_targets.macos.is_empty() {
        env_args.push(deployment_targets.macos.clone());
    }
    if !deployment_targets.ios.is_empty() {
        env_args.push(deployment_targets.ios.clone());
    }
    if !deployment_targets.tvos.is_empty() {
        env_args.push(deployment_targets.tvos.clone());
    }
    if !deployment_targets.watchos.is_empty() {
        env_args.push(deployment_targets.watchos.clone());
    }
    if !deployment_targets.visionos.is_empty() {
        env_args.push(deployment_targets.visionos.clone());
    }
    env_args.push(format!("SYMROOT={}", out_lib_dir.to_str().unwrap()));

    let status = if sdk == "macosx" && !can_use_xcodebuild() {
        None
    } else if sdk == "maccatalyst" {
        Some({
            let c = Command::new("xcrun")
                .arg("--show-sdk-path")
                .output()
                .unwrap();
            let line = String::from_utf8(c.stdout).unwrap();
            let line = line.lines().next().unwrap();

            println!("cargo:rustc-link-search=system={line}/System/iOSSupport/usr");
            println!(
                "cargo:rustc-link-search=framework={line}/System/iOSSupport/System/Library/Frameworks"
            );

            // -isystem $(MACOSX_SDK_DIR)/System/iOSSupport/usr/include \
            // -iframework $(MACOSX_SDK_DIR)/System/iOSSupport/System/Library/Frameworks
            Command::new("xcodebuild")
                .args(["-project", "./pomace/pomace.xcodeproj"])
                .args(["-sdk", "macosx"])
                .args(["-arch", arch])
                .args(["-configuration", configuration])
                // .args(["-derivedDataPath", out_lib_dir.to_str().unwrap()])
                .args([
                    "-destination 'generic/platform=macOS,variant=Mac Catalyst'",
                    "SUPPORTS_MACCATALYST=YES",
                ])
                .args(targets)
                .arg("build")
                .args(env_args)
                .status()
                .unwrap()
        })
    } else {
        Some(
            Command::new("xcodebuild")
                .args(["-project", "./pomace/pomace.xcodeproj"])
                .args(["-sdk", sdk])
                .args(["-arch", arch])
                .args(["-configuration", configuration])
                .args(targets)
                // .args(["-derivedDataPath", out_lib_dir.to_str().unwrap()])
                .arg("build")
                .args(env_args)
                .status()
                .unwrap(),
        )
    };

    out_lib_dir.push(configuration);

    let mut s = out_lib_dir.to_str().unwrap().to_string();

    if sdk != "macosx" {
        s.push('-');
        s.push_str(sdk);
    }

    println!("cargo:rustc-link-search=native={s}");

    if let Some(status) = status {
        if status.success() {
            return;
        }
        if sdk != "macosx" {
            assert!(status.success());
        }
    }

    if sdk == "macosx" {
        clt_build_macos(targets, arch, deployment_targets, Path::new(&s));
        return;
    }

    panic!("xcodebuild is required to build cidre for {sdk}");
}

fn can_use_xcodebuild() -> bool {
    Command::new("xcodebuild")
        .arg("-version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn xcrun_stdout(args: &[&str]) -> String {
    let output = Command::new("xcrun")
        .args(args)
        .output()
        .expect("failed to run xcrun");
    if !output.status.success() {
        panic!("xcrun {:?} failed", args);
    }
    String::from_utf8(output.stdout)
        .expect("xcrun returned non-UTF8 output")
        .trim()
        .to_string()
}

fn xc_target_names(targets: &[&'static str]) -> Vec<&'static str> {
    let mut names = Vec::new();
    let mut iter = targets.iter();
    while let Some(arg) = iter.next() {
        if *arg == "-target" {
            if let Some(target) = iter.next() {
                names.push(*target);
            }
        }
    }
    names
}

fn deployment_target(setting: &str, prefix: &str, fallback: &str) -> String {
    setting
        .strip_prefix(prefix)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn clt_build_macos(
    targets: &[&'static str],
    arch: &str,
    deployment_targets: &DeploymentTargets,
    out_lib_dir: &Path,
) {
    fs::create_dir_all(out_lib_dir).expect("failed to create cidre output library directory");

    let sdk_path = xcrun_stdout(&["--sdk", "macosx", "--show-sdk-path"]);
    let clang = xcrun_stdout(&["--sdk", "macosx", "--find", "clang"]);
    let ar = xcrun_stdout(&["--find", "ar"]);
    let macos_min = deployment_target(
        &deployment_targets.macos,
        "MACOSX_DEPLOYMENT_TARGET=",
        "13.0",
    );
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    for target in xc_target_names(targets) {
        let source = manifest_dir
            .join("pomace")
            .join(target)
            .join(format!("{target}.m"));
        let object = out_lib_dir.join(format!("{target}.o"));
        let archive = out_lib_dir.join(format!("lib{target}.a"));

        if !source.exists() {
            panic!("missing cidre pomace source for target {target}");
        }
        if archive.exists() {
            fs::remove_file(&archive).expect("failed to remove stale cidre archive");
        }

        let clang_status = Command::new(&clang)
            .args([
                "-x",
                "objective-c",
                "-fobjc-arc",
                "-fno-common",
                "-isysroot",
                &sdk_path,
                "-arch",
                arch,
            ])
            .arg(format!("-mmacosx-version-min={macos_min}"))
            .arg("-c")
            .arg(&source)
            .arg("-o")
            .arg(&object)
            .status()
            .expect("failed to run clang for cidre pomace source");
        assert!(clang_status.success(), "clang failed for cidre target {target}");

        let ar_status = Command::new(&ar)
            .arg("crus")
            .arg(&archive)
            .arg(&object)
            .status()
            .expect("failed to run ar for cidre pomace archive");
        assert!(ar_status.success(), "ar failed for cidre target {target}");
    }
}

fn parse_deployment_targets() -> DeploymentTargets {
    let path = env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = PathBuf::from_str(&path).unwrap();
    let path = path.join("Cargo.toml");
    let str = read_to_string(path).unwrap();
    let mut lines_iter = str.lines().into_iter();
    while let Some(line) = lines_iter.next() {
        if !line.starts_with("# deployment targets") {
            continue;
        }
        break;
    }

    let mut macos = Vec::new();
    let mut ios = Vec::new();
    let mut tvos = Vec::new();
    let mut maccatalyst = Vec::new();
    let mut watchos = Vec::new();
    let mut visionos = Vec::new();

    while let Some(line) = lines_iter.next() {
        if line.starts_with("# end of deployment targets") {
            break;
        }

        let Some((val, _)) = line.split_once(" ") else {
            continue;
        };

        let Some((platform, ver_str)) = val.split_once("_") else {
            continue;
        };

        let Some(ver) = Version::with_str(ver_str) else {
            continue;
        };

        match platform {
            "macos" => macos.push((format!("CARGO_FEATURE_MACOS_{ver_str}"), ver)),
            "ios" => ios.push((format!("CARGO_FEATURE_IOS_{ver_str}"), ver)),
            "tvos" => tvos.push((format!("CARGO_FEATURE_TVOS_{ver_str}"), ver)),
            "maccatalyst" => {
                maccatalyst.push((format!("CARGO_FEATURE_MACCATALYST_{ver_str}"), ver))
            }
            "watchos" => watchos.push((format!("CARGO_FEATURE_WATCHOS_{ver_str}"), ver)),
            "visionos" => visionos.push((format!("CARGO_FEATURE_VISIONOS_{ver_str}"), ver)),
            _ => {
                panic!("unknown platform {platform:?}");
            }
        }
    }

    macos.reverse();
    ios.reverse();
    tvos.reverse();
    maccatalyst.reverse();
    watchos.reverse();
    visionos.reverse();

    let mut res = DeploymentTargets::default();

    if let Some(v) = Version::with_table(&macos) {
        res.macos = format!("MACOSX_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&ios) {
        res.ios = format!("IPHONEOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&tvos) {
        res.tvos = format!("TVOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&watchos) {
        res.watchos = format!("WATCHOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&maccatalyst) {
        // TODO: investigate
        res.ios = format!("IPHONEOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&visionos) {
        res.visionos = format!("XROS_DEPLOYMENT_TARGET={}", v.to_string());
    }

    res
}

fn main() {
    if std::env::var("DOCS_RS").is_ok() {
        return;
    }

    let versions = parse_deployment_targets();

    let sdk = match env::var("TARGET").unwrap().as_ref() {
        "aarch64-apple-darwin" | "x86_64-apple-darwin" => "macosx",
        "aarch64-apple-ios" => "iphoneos",
        "x86_64-apple-ios" | "aarch64-apple-ios-sim" => "iphonesimulator",
        "aarch64-apple-ios-macabi" => "maccatalyst",
        "aarch64-apple-tvos" => "appletvos",
        "aarch64-apple-tvos-sim" => "appletvsimulator",
        "arm64_32-apple-watchos" => "watchos",
        "aarch64-apple-watchos" => "watchos",
        "aarch64-apple-watchos-sim" => "watchsimulator",
        "aarch64-apple-visionos" => "xros",
        "aarch64-apple-visionos-sim" => "xrsimulator",
        x => panic!("unknown tripple: {x}"),
    };

    let clang_rt = match sdk {
        "macosx" => "clang_rt.osx",
        "iphoneos" => "clang_rt.ios",
        "iphonesimulator" => "clang_rt.iossim",
        "appletvos" => "clang_rt.tvos",
        "appletvsimulator" => "clang_rt.tvossim",
        "watchos" => "clang_rt.watchos",
        "watchossimulator" => "clang_rt.watchossim",
        "xros" => "clang_rt.xros",
        "xrsimulator" => "clang_rt.xrossim",
        "maccatalyst" => "clang_rt.ios", // check
        x => panic!("unknown sdk {x}"),
    };

    println!("cargo:rustc-link-lib={}", clang_rt);
    println!("cargo:rustc-link-search={}", clang_link_search_path());

    let arch = match env::var("TARGET").unwrap().as_ref() {
        "aarch64-apple-ios-macabi"
        | "aarch64-apple-darwin"
        | "aarch64-apple-ios"
        | "aarch64-apple-tvos"
        | "aarch64-apple-tvos-sim"
        | "aarch64-apple-ios-sim"
        | "aarch64-apple-watchos-sim"
        | "aarch64-apple-visionos"
        | "aarch64-apple-visionos-sim" => "arm64",
        "x86_64-apple-ios" | "x86_64-apple-darwin" => "x86_64",
        "arm64_32-apple-watchos" => "arm64_32",
        x => panic!("unknown tripple: {x}"),
    };

    let configuration = match env::var("PROFILE").unwrap().as_str() {
        "release" => "Release",
        "debug" => "Debug",
        x => panic!("unknown profile: {x}"),
    };

    let mut xc_target_args = Vec::new();

    add_xc_target_args_from_features(
        &mut xc_target_args,
        &["ut", "un", "sn", "ns", "av", "cl", "nl", "ml"],
    );

    if sdk != "watchos" && sdk != "watchsimulator" {
        add_xc_target_args_from_features(
            &mut xc_target_args,
            &[
                "ca", "vn", "mps", "mpsg", "mc", "mtl", "mtk", "ci", "gc", "av_kit",
            ],
        );
        if sdk != "xros" && sdk != "xrsimulator" {
            add_xc_target_args_from_features(&mut xc_target_args, &["mlc"]);
        }
    }

    if sdk != "appletvos" && sdk != "appletvsimulator" {
        add_xc_target_args_from_features(&mut xc_target_args, &["core_motion"]);
    }

    if sdk != "appletvos"
        && sdk != "appletvsimulator"
        && sdk != "watchos"
        && sdk != "watchsimulator"
    {
        add_xc_target_args_from_features(&mut xc_target_args, &["wk"]);
    }

    if [
        "iphoneos",
        "iphonesimulator",
        "maccatalyst",
        "appletvos",
        "appletvsimulator",
        "watchos",
        "watchosimulator",
        "visionos",
        "visionsimulator",
    ]
    .contains(&sdk)
    {
        add_xc_target_args_from_features(&mut xc_target_args, &["ui"]);
    }
    if sdk == "iphoneos" || sdk == "iphonesimulator" {
        add_xc_target_args_from_features(&mut xc_target_args, &["wc"]);
    }
    if sdk == "macosx" || sdk == "maccatalyst" {
        add_xc_target_args_from_features(&mut xc_target_args, &["sc", "app"]);
        if env::var_os("CARGO_FEATURE_PRIVATE").is_some() {
            println!("cargo:rustc-link-search=framework=/System/Library/PrivateFrameworks");
            println!(
                "cargo:rustc-link-search=framework=/Library/Apple/System/Library/PrivateFrameworks"
            );
        }
    }
    if sdk == "macosx" {
        add_xc_target_args_from_features(&mut xc_target_args, &["core_audio"]);
    }

    println!("cargo:rerun-if-changed=./pomace/");
    xc_build(&xc_target_args, sdk, arch, configuration, &versions);
}

fn clang_link_search_path() -> String {
    let output = Command::new("/usr/bin/clang")
        .arg("--print-search-dirs")
        .output()
        .unwrap();
    if !output.status.success() {
        panic!("Can't get search paths from clang");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some((a, b)) = line.split_once('=') {
            if a == "libraries: " {
                return format!("{}/lib/darwin", b);
            }
        }
    }
    panic!("clang is missing search paths");
}
