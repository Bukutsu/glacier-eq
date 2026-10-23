// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
use super::*;
use crate::device::families::fiio;

#[test]
fn fiio_unknown_products_and_serial_models_never_get_a_hid_fallback() {
    for vid in [0x2972, 0x0a12] {
        assert!(get_supported_device(vid, 0xffff).is_none());
        for name in [
            "FIIO KA1",
            "FIIO KA5",
            "FIIO KA13",
            "FIIO K15",
            "FIIO K17",
            "FIIO K17 R2R",
            "FIIO K19",
            "USB20",
            "Some headset",
        ] {
            assert!(
                get_supported_device_with_name(vid, 0xffff, Some(name)).is_none(),
                "{name}"
            );
        }
    }
}
#[test]
fn new_names_are_exact_and_every_declared_route_is_discoverable() {
    for profile in SUPPORTED_DEVICES {
        let aliases = fiio::registry::product_names(profile.name);
        for name in aliases {
            let pid = match profile.name {
                "FIIO QX11" => 0x0130,
                "FIIO BT11" => 0x4032,
                "FIIO Air Link" => 0x4033,
                _ => profile.product_id.unwrap_or(0xffff),
            };
            let found = get_supported_device_with_name(
                profile.vendor_id,
                pid,
                Some(&format!(" {} ", name.to_lowercase())),
            )
            .unwrap();
            assert_eq!(found.name, profile.name);
            if profile.product_id.is_none()
                && !["FIIO QX11", "FIIO BT11", "FIIO Air Link"].contains(&profile.name)
            {
                assert_eq!(
                    get_supported_device_with_name(profile.vendor_id, 0xffff, Some(name))
                        .unwrap()
                        .name,
                    profile.name
                );
            }
            assert!(
                get_supported_device_with_name(
                    profile.vendor_id,
                    0xfffe,
                    Some(&format!("{name} plus"))
                )
                .is_none(),
                "{name}"
            );
        }
    }
    assert_eq!(
        get_supported_device_with_name(0x2972, 0xffff, Some("FIIO DSP Audio"))
            .unwrap()
            .name,
        "FIIO LS-TC2"
    );
    assert_eq!(
        get_supported_device(0x2972, 0x0126).unwrap().name,
        "SNOWSKY Melody"
    );
    assert_eq!(
        get_supported_device(0x2972, 0x0147).unwrap().caps.num_bands,
        10
    );
}
#[test]
fn models_with_separate_modes_require_the_proven_pid() {
    for name in ["FIIO QX11", "FIIO BT11", "FIIO Air Link"] {
        for pid in [0xffff, 0x4014, 0x4007] {
            assert!(get_supported_device_with_name(0x2972, pid, Some(name)).is_none());
            assert!(get_supported_device_with_name(0x0a12, pid, Some(name)).is_none());
        }
    }
}
#[test]
fn fiio_filters_and_user_banks_follow_the_model_not_just_the_vendor() {
    use crate::eq::FilterType;
    let mage = get_supported_device_with_name(0x2972, 0xffff, Some("SNOWSKY MAGE")).unwrap();
    assert!(!mage
        .caps
        .supported_filter_types
        .contains(&FilterType::HighShelf));
    assert!(mage
        .caps
        .supported_filter_types
        .contains(&FilterType::HighPass));
    for pid in [0x0104, 0x0093, 0x0126, 0x0128, 0x0120, 0x0147] {
        assert_eq!(
            get_supported_device(0x2972, pid)
                .unwrap()
                .caps
                .supported_filter_types,
            FilterType::ALL
        );
    }
    for name in [
        "FIIO BTR15",
        "FIIO BTR17",
        "FIIO FP3",
        "FIIO FX25",
        "FIIO LS-TC2",
        "OAK NANO",
    ] {
        let p = get_supported_device_with_name(0x2972, 0xffff, Some(name)).unwrap();
        assert_eq!(p.caps.supported_filter_types, LIMITED_FILTER_TYPES);
        assert_eq!(p.status, "Untested");
    }
}
