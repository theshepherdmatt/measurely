#!/usr/bin/env python3
"""
Measurely WiFi Configuration Portal for NetworkManager + wpa_supplicant
Works with your specific system configuration
"""

import os
import subprocess
import json
import re
import time
import threading
from flask import Flask, render_template, request, jsonify, redirect, url_for

# Create Flask app with template folder
app = Flask(__name__, template_folder='/home/matt/measurely/onboard/templates')
app.config['SECRET_KEY'] = 'measurely-wifi-setup-secret-key'

# Configuration paths
BASE_DIR = '/home/matt/measurely'
CONFIG_FILE = os.path.join(BASE_DIR, 'config', 'wifi_config.json')
WPA_SUPPLICANT_CONF = '/etc/wpa_supplicant/wpa_supplicant.conf'
HOSTAPD_CONF = os.path.join(BASE_DIR, 'config', 'hostapd.conf')
DNSMASQ_CONF = os.path.join(BASE_DIR, 'config', 'dnsmasq.conf')

class WiFiManager:
    def __init__(self):
        self.interface = self.get_wifi_interface()
        
    def get_wifi_interface(self):
        """Get the WiFi interface name"""
        try:
            result = subprocess.run(['iwconfig'], capture_output=True, text=True)
            for line in result.stdout.split('\n'):
                if 'IEEE 802.11' in line:
                    return line.split()[0]
        except:
            pass
        return 'wlan0'
    
    def scan_networks(self):
        """Scan for available WiFi networks"""
        try:
            # Get scan results
            result = subprocess.run(['sudo', 'iwlist', self.interface, 'scan'], 
                                  capture_output=True, text=True)
            
            networks = []
            current_network = {}
            
            for line in result.stdout.split('\n'):
                line = line.strip()
                if 'Cell' in line and 'Address:' in line:
                    if current_network:
                        networks.append(current_network)
                    current_network = {'bssid': line.split('Address: ')[1]}
                elif 'ESSID:' in line:
                    essid = line.split('ESSID:"')[1].split('"')[0]
                    current_network['ssid'] = essid
                elif 'Encryption key:' in line:
                    current_network['encrypted'] = 'on' in line
                elif 'IE: IEEE 802.11i/WPA2' in line:
                    current_network['security'] = 'WPA2'
                elif 'IE: WPA Version 1' in line:
                    current_network['security'] = 'WPA'
                elif 'Encryption key:off' in line:
                    current_network['security'] = 'Open'
                    
            if current_network:
                networks.append(current_network)
                
            # Remove duplicates
            seen = set()
            unique_networks = []
            for net in networks:
                if net.get('ssid') and net['ssid'] not in seen:
                    seen.add(net['ssid'])
                    unique_networks.append(net)
            
            return unique_networks
            
        except Exception as e:
            print(f"Error scanning networks: {e}")
            return []
        
    def get_network_security(self, ssid):
        """Get the security type for a specific network"""
        try:
            # Get detailed network info from NetworkManager (corrected fields)
            result = subprocess.run(['nmcli', '-t', '-f', 'SSID,SECURITY,WPA-FLAGS,RSN-FLAGS', 'device', 'wifi'], 
                                capture_output=True, text=True)
            
            for line in result.stdout.strip().split('\n'):
                if ssid in line:
                    parts = line.split(':')
                    if len(parts) >= 4:
                        ssid_found = parts[0]
                        security = parts[1]
                        wpa_flags = parts[2] if parts[2] != '--' else None
                        rsn_flags = parts[3] if parts[3] != '--' else None
                        
                        print(f"Network {ssid_found} - Security: {security}, WPA-Flags: {wpa_flags}, RSN-Flags: {rsn_flags}")
                        
                        # Determine security type based on flags
                        if wpa_flags and 'pair-psk' in wpa_flags:
                            return 'WPA', 'wpa-psk'
                        elif rsn_flags and 'pair-psk' in rsn_flags:
                            return 'WPA2', 'wpa-psk'
                        elif wpa_flags and 'group-wep' in wpa_flags:
                            return 'WEP', 'none'
                        elif security == 'Open' or (not wpa_flags and not rsn_flags):
                            return 'Open', 'none'
                        elif wpa_flags or rsn_flags:
                            # Has WPA/WPA2 flags but not standard PSK
                            return 'WPA/WPA2', 'wpa-psk'
            
            # Alternative: Check with nmcli connection info
            connections = subprocess.run(['nmcli', '-t', '-f', 'NAME,TYPE,ACTIVE', 'connection', 'show'], 
                                    capture_output=True, text=True)
            
            for line in connections.stdout.strip().split('\n'):
                if ssid in line and 'wifi' in line:
                    parts = line.split(':')
                    if len(parts) >= 3:
                        connection_name = parts[0]
                        # Get connection details
                        conn_details = subprocess.run(['nmcli', '-t', '-f', '802-11-wireless-security.key-mgmt', 
                                                    'connection', 'show', connection_name], 
                                                    capture_output=True, text=True)
                        
                        key_mgmt = conn_details.stdout.strip()
                        if key_mgmt and key_mgmt != '--':
                            return 'Detected', key_mgmt
            
            # Final fallback: assume based on security field
            if 'WPA2' in security:
                return 'WPA2', 'wpa-psk'
            elif 'WPA' in security:
                return 'WPA', 'wpa-psk'
            else:
                return 'Unknown', 'wpa-psk'
                
        except Exception as e:
            print(f"Security detection error: {e}")
            return 'Unknown', 'none'  # Safe default for unknown networks
    
    def connect_to_network(self, ssid, password):
        """Create a clean NetworkManager WiFi connection with correct security."""
        try:
            print(f"Cleaning up old profiles for SSID: {ssid}")

            # Delete old connections with the same SSID
            existing = subprocess.run(
                ['nmcli', '-t', '-f', 'NAME', 'connection', 'show'],
                capture_output=True, text=True
            )
            for line in existing.stdout.split('\n'):
                if line.strip() == ssid:
                    subprocess.run(['sudo', 'nmcli', 'connection', 'delete', ssid])

            print("Creating new connection profile...")

            # Create the connection profile with proper security block
            create = subprocess.run([
                'sudo', 'nmcli', 'connection', 'add',
                'type', 'wifi',
                'ifname', self.interface,
                'con-name', ssid,
                'ssid', ssid,
                'wifi-sec.key-mgmt', 'wpa-psk',
                'wifi-sec.psk', password,
                'ipv4.method', 'auto',
                'ipv6.method', 'ignore'
            ], capture_output=True, text=True)

            if create.returncode != 0:
                print("Connection creation failed:", create.stderr)
                return False, create.stderr.strip()

            print("Activating new connection profile...")

            # Bring up the new connection
            up = subprocess.run([
                'sudo', 'nmcli', 'connection', 'up', ssid
            ], capture_output=True, text=True)

            if up.returncode == 0:
                return True, f"Connected to {ssid} successfully via NetworkManager"
            else:
                print("Activation failed:", up.stderr)
                return False, up.stderr.strip()

        except Exception as e:
            return False, str(e)

    
    def save_config(self, config):
        """Save WiFi configuration"""
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump(config, f)
        except Exception as e:
            print(f"Error saving config: {e}")
    
    def is_configured(self):
        """Check if WiFi is already configured"""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    return config.get('configured', False)
        except:
            pass
        return False

# Create WiFi manager
wifi_manager = WiFiManager()

@app.route('/')
def index():
    """Main configuration page"""
    return render_template('wifi_setup.html')

@app.route('/scan')
def scan_networks():
    """Scan for available networks"""
    networks = wifi_manager.scan_networks()
    return jsonify({'networks': networks})

@app.route('/connect', methods=['POST'])
def connect():
    """Actually connect to selected network"""
    data = request.json
    ssid = data.get('ssid')
    password = data.get('password')
    
    if not ssid or not password:
        return jsonify({'success': False, 'error': 'SSID and password required'})
    
    try:
        print(f"Connecting to {ssid}...")
        
        # Attempt to connect
        success, message = wifi_manager.connect_to_network(ssid, password)
        
        if success:
            # Save successful config
            wifi_manager.save_config({'ssid': ssid, 'configured': True})
            return jsonify({
                'success': True, 
                'message': message,
                'action': 'reboot_suggested'
            })
        else:
            return jsonify({
                'success': False, 
                'error': message
            })
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/status')
def status():
    """Check connection status"""
    try:
        # Try NetworkManager first
        result = subprocess.run(['nmcli', '-t', '-f', 'DEVICE,STATE', 'device', 'status'], 
                              capture_output=True, text=True)
        
        for line in result.stdout.split('\n'):
            if 'wlan0:connected' in line:
                # Get current SSID
                ssid_result = subprocess.run(['nmcli', '-t', '-f', 'GENERAL.CONNECTION', 'device', 'show', 'wlan0'], 
                                           capture_output=True, text=True)
                ssid = ssid_result.stdout.strip().split(':')[-1] if ':' in ssid_result.stdout else 'Unknown'
                
                return jsonify({
                    'connected': True,
                    'ssid': ssid,
                    'interface': 'wlan0',
                    'method': 'NetworkManager'
                })
        
        # Fallback to iwconfig if NetworkManager doesn't show connected
        result = subprocess.run(['iwconfig', wifi_manager.interface], 
                              capture_output=True, text=True)
        
        if 'ESSID:' in result.stdout and 'off/any' not in result.stdout:
            # Extract SSID from iwconfig output
            for line in result.stdout.split('\n'):
                if 'ESSID:' in line:
                    ssid = line.split('ESSID:"')[1].split('"')[0] if 'ESSID:"' in line else 'Unknown'
                    return jsonify({
                        'connected': True,
                        'ssid': ssid,
                        'interface': wifi_manager.interface,
                        'method': 'wpa_supplicant'
                    })
        
        return jsonify({
            'connected': False,
            'interface': wifi_manager.interface,
            'method': 'none'
        })
    except:
        return jsonify({'connected': False, 'interface': wifi_manager.interface})

@app.route('/reboot', methods=['POST'])
def reboot():
    """Reboot the system"""
    try:
        # Schedule reboot in 5 seconds
        def delayed_reboot():
            time.sleep(5)
            subprocess.run(['sudo', 'reboot'])
        
        threading.Thread(target=delayed_reboot).start()
        
        return jsonify({
            'success': True, 
            'message': 'System will reboot in 5 seconds...'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/complete')
def complete():
    """Setup complete page"""
    return render_template('setup_complete.html')

if __name__ == '__main__':
    print("Starting Measurely WiFi Configuration Portal...")
    print("Access at: http://localhost:8080")
    print("Scan API at: http://localhost:8080/scan")
    print(f"Your system has: NetworkManager + wpa_supplicant")
    app.run(host='192.168.4.1', port=8080, debug=False)