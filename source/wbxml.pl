#!/usr/bin/perl

use strict;
use warnings;

use CGI::Minimal;

my $cgi = CGI::Minimal->new();

my $octets = $cgi->param( 'octets' ) || $ARGV[0] || '';
my $text = '';
my $xml = '';

for (my $i = 0; $i < length $octets; $i += 2) {
    $text .= chr hex substr( $octets, $i, 2 );
}

eval 'use XML::WBXML';

if (!$@) {
    $xml = XML::WBXML::wbxml_to_xml( $text );
}

binmode STDOUT, ':utf8';

print "Content-Type: text/plain; charset=UTF-8\r\n\r\n$xml";
