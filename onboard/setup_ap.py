#!/usr/bin/env python3
"""
Setup script for Measurely WiFi Access Point mode
"""
print("DEBUG — RUNNING FILE:", __file__)

import os
import subprocess
import time

def setup_access_point():
    """Configure Raspberry Pi as WiFi Access Point"""
    
    # Install required packages
    packages = ['hostapd', 'dnsmasq', 'iptables-persistent']
    #subprocess.run(['sudo', 'apt', 'update'])
    #subprocess.run(['sudo', 'apt', 'install', '-y'] + packages)
    
    # Configure hostapd
    hostapd_conf = """interface=wlan0
driver=nl80211
ssid=measurely-setup
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=measurely123
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
country_code=US
"""
    
    with open('/tmp/hostapd.conf', 'w') as f:
        f.write(hostapd_conf)
    subprocess.run(['sudo', 'cp', '/tmp/hostapd.conf', '/etc/hostapd/hostapd.conf'])
    
    # Configure dnsmasq
    dnsmasq_conf = """interface=wlan0
dhcp-range=192.168.4.2,192.168.4.100,255.255.255.0,24h
domain=wlan
address=/gw.wlan/192.168.4.1
"""
    
    # Backup original dnsmasq.conf if it exists
    if os.path.exists('/etc/dnsmasq.conf'):
        subprocess.run(['sudo', 'cp', '/etc/dnsmasq.conf', '/etc/dnsmasq.conf.backup'])
    
    with open('/tmp/dnsmasq.conf', 'w') as f:
        f.write(dnsmasq_conf)
    subprocess.run(['sudo', 'cp', '/tmp/dnsmasq.conf', '/etc/dnsmasq.conf'])
    
    # Configure static IP
    subprocess.run(['sudo', 'ip', 'addr', 'add', '192.168.4.1/24', 'dev', 'wlan0'])
    
    # Enable IP forwarding
    subprocess.run(['sudo', 'sysctl', 'net.ipv4.ip_forward=1'])
    
    # Configure iptables
    subprocess.run(['sudo', 'iptables', '-t', 'nat', '-A', 'POSTROUTING', '-o', 'eth0', '-j', 'MASQUERADE'])
    subprocess.run(['sudo', 'iptables', '-A', 'FORWARD', '-i', 'eth0', '-o', 'wlan0', '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'])
    subprocess.run(['sudo', 'iptables', '-A', 'FORWARD', '-i', 'wlan0', '-o', 'eth0', '-j', 'ACCEPT'])
    
    # Save iptables rules
    subprocess.run(['sudo', 'netfilter-persistent', 'save'])
    
    # Enable services
    subprocess.run(['sudo', 'systemctl', 'unmask', 'hostapd'])
    subprocess.run(['sudo', 'systemctl', 'enable', 'hostapd'])
    subprocess.run(['sudo', 'systemctl', 'enable', 'dnsmasq'])
    
    # Start services
    subprocess.run(['sudo', 'systemctl', 'start', 'hostapd'])
    subprocess.run(['sudo', 'systemctl', 'start', 'dnsmasq'])
    
    print("Access point setup complete!")
    print("SSID: measurely-setup")
    print("Password: measurely123")
    print("IP Range: 192.168.4.2-100")

if __name__ == '__main__':
    setup_access_point()
