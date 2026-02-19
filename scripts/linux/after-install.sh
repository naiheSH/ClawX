#!/bin/bash

# Post-installation script for ClawX on Linux

set -e

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

# Create symbolic link for CLI access (optional)
if [ -x /opt/ClawX/clawx ]; then
    ln -sf /opt/ClawX/clawx /usr/local/bin/clawx 2>/dev/null || true
fi

# Create desktop shortcut for all users
DESKTOP_FILE="/usr/share/applications/clawx.desktop"
if [ -f "$DESKTOP_FILE" ]; then
    for user_home in /home/*; do
        [ -d "$user_home" ] || continue
        # Try common desktop directory names (English and localized)
        for desktop_dir in "$user_home/Desktop" "$user_home/桌面"; do
            if [ -d "$desktop_dir" ]; then
                cp "$DESKTOP_FILE" "$desktop_dir/" 2>/dev/null || true
                username=$(basename "$user_home")
                chown "$username:$username" "$desktop_dir/clawx.desktop" 2>/dev/null || true
                chmod +x "$desktop_dir/clawx.desktop" 2>/dev/null || true
                break
            fi
        done
    done
fi

echo "ClawX has been installed successfully."
