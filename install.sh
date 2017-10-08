#! /bin/sh

# Works on Debian 9 (Stretch)

sudo apt-get install build-essential libwbxml2-dev cpanminus
sudo cpanm CGI::Minimal XML::WBXML
sudo a2enmod cgi
