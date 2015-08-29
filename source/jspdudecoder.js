/*jslint browser: true */
/*global require, cleanInput, constructOutput, setForm, pduDecoder, splitter, tokenizer, tokens, wapDecoder, reverse, padwZeros, console, getChar, wapTokens, gsm7bit */
/**
 * pduDecoder
 *
 * Catches the submit event of a form with id 'fPdu', decodes the PDU encoded SMS provided in
 * a contained form element named 'pdu' and writes the result in an element with id 'output'.
 *
 * For use with User-Data-only PDU strings there are some parameters available:
 *
 * - Checkbox 'ud_only', if set will generate a valid PDU header in consideration of the following flags:
 * - Radio group: 'alphabet', values 'standard', 'ucs2' or '8bit' will set the respective encoding flags
 * - Checkbox 'udhi' will set the User-Data-Header-Indicator flag
 *
 * All form field values can be set as URI parameters and will be copied to their respective fields on startup.
 * If at least one parameter was given, the decoding starts immediately.
 *
 * This is done twice:
 *  - using a library from {@linkplain http://twit88.com/home/utility/sms-pdu-encode-decode} (if exists)
 *  - using a self made parser provided herein
 * @author Benjamin Erhart <be@benjaminerhart.com>
 * @constructor
 */
(function(){
    'use strict';

    var $ = require('jquery');


    $( 'document' ).ready( function() {

        $( '#ud_only' ).change( function( evt ) {
            if (evt.target.checked) {
                $( '.prefix' ).attr( 'disabled', false );
            }
            else {
                $( '.prefix' ).attr( 'disabled', true );
            }
        } );

        $( 'form#fPdu' ).find( ':input' ).change( function( evt ) {
            $( 'form#fPdu' ).submit();
        } );

        $( 'form#fPdu' ).submit( function( evt ) {
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();

            var t = evt.target;

            cleanInput( t.pdu );

            var pdu = t.pdu.value;

            if (!pdu) {
                $( '#output' ).empty();
                return false;
            }

            var prefix = '00';
            var alphabet;
            var len;

            if (t.ud_only.checked) {

                if (t.udhi.checked) {
                    prefix += '41';
                }
                else {
                    prefix += '01';
                }

                prefix += '000000';

                $( t.alphabet ).each( function() {
                    if (this.checked) {
                        alphabet = this.value;
                    }
                } );

                if (alphabet === 'standard') {
                    prefix += '00';
                }
                else if (alphabet === 'ucs2') {
                    prefix += '08';
                }
                else if (alphabet === '8bit') {
                    prefix += '04';
                }

                len = (pdu.length / 2).toString( 16 );

                prefix +=  len.length < 2 ? '0' + len : len;

                pdu = prefix + pdu;
            }

            $( '#output' ).html( constructOutput( pdu ) );

            $( '#output' ).find( 'td:last:contains(&lt;)' ).each( function() {
                var $this = $( this );

                $this.text( $this.text().replace( /&lt;/g, '<' ).replace( /&gt;/g, '>' ).replace( /&amp;/g, '&' ) );
            } );

            if (t.ud_only.checked) {
                $( 'table.data > tbody' ).prepend( '<tr><td colspan="2" class="one">Some information hidden - click here to reveal.</td></tr>' );
                $( 'table.data tr.hideable' ).hide();
                $( 'table.data td.one' ).click( function() {
                    $( 'table.data td.one' ).parent().remove();
                    $( 'table.data tr.hideable' ).show();
                } );
            }

            return false;
        } );

        if (setForm()) {
            $( 'form#fPdu' ).submit();
        }
    } );

    /**
     * Constructs the HTML markup with the information derived from two decoders.
     *
     * @param {String} pdu Contains the PDU decoded SMS
     * @return HTML markup
     * @type String
     */
    function constructOutput( pdu ) {
        var i,
            info = '';

        var data = pduDecoder( pdu );

        var datastr = '';

        if (typeof data === 'object') {
            for (i = 0; i < data.length; ++i) {
                datastr += '<tr><td>' + data[ i ].replace( /\t/, '</td><td>' ) + '</td></tr>';
            }
        }
        else {
            // Probably an error text instead of decoded PDU information
            datastr = '<tr><td>' + data + '</td></tr>';
        }

        datastr = datastr.replace( /><td>\(hideable\)/g, ' class="hideable"><td>' );

        return '<p>' + info.replace( /\n/g, '<br />' ) + '</p><table class="data"><tbody>' + datastr + '</tbody></table>';
    }

    /**
     * Actual implementation of a PDU decoder. Decodes all information defined in
     * {@linkplain http://www.dreamfabric.com/sms/} and {@linkplain http://mobiletidings.com/}
     *
     * @param {String} pdu Contains the PDU decoded SMS
     * @return Decoded information from PDU as one dimensional array, description and information split through '\t'
     * or error string if not a valid PDU
     * @type Array | String
     */
    function pduDecoder( pdu ) {
        var i,
            result = [];

        var octets = splitter( pdu );

        if (!octets) {
            return "Invalid PDU String!";
        }

        var tokens = tokenizer( octets );

        for (i = 0; i < tokens.length; ++i) {
            result.push( tokens[ i ]() );
        }

        return result;
    }

    /**
     * Splits a PDU string into an array of 2 byte octets
     *
     * @param {String} pdu
     * @return Octets or null if PDU contains invalid characters or has invalid length
     * @type Array | null
     */
    function splitter( pdu ) {
        var i,
            octets = [];

        for (i = 0; i < pdu.length; i += 2) {
            var octet = pdu.substr( i, 2 );

            if (!octet.match( /^[0-9A-F]{2}$/i )) {
                return null;
            }

            octets.push( octet );
        }

        return octets;
    }

    /**
     * Analyses the PDU octets and returns a list of functions representing one line of
     * information, each.
     *
     * @param {Array} octets
     * @return List of tokens represented by resolving functions
     * @type Array
     */
    function tokenizer( octets ) {
        var tokenList = [];
        var pos = 0;
        var numberLength;
        var sliceNumber;
        var sliceNumberToA;
        var TP_PID;
        var TP_DCS;

        // smsc part
        var smscLength = parseInt( octets[0], 16 );

        if (smscLength) {
            var sliceSmsc = octets.slice( 2, smscLength + 1 );
            tokenList.push( function(){ return '(hideable)SMSC number\t' + tokens.Number( sliceSmsc ); } );
            var sliceSmscToA = octets[1];
            tokenList.push( function(){ return '(hideable)SMSC number info\t' + tokens.ToA( sliceSmscToA ); } );
        }

        // Sender/Receiver part
        pos = smscLength + 1;
        var pduType = tokens.ToM( octets[ pos ] );
        tokenList.push( function(){ return '(hideable)PDU Type\t' + pduType.info; } );

        if (pduType.type === 'deliver') {
            pos++;
            numberLength = parseInt( octets[ pos ], 16 );

            pos++;
            if (numberLength) {
                sliceNumber = octets.slice( pos + 1, pos + 1 + Math.ceil( numberLength / 2 ) );
                tokenList.push( function(){ return '(hideable)Number\t' + tokens.Number( sliceNumber, numberLength ); } );

                sliceNumberToA = octets[ pos ];
                tokenList.push( function(){ return '(hideable)Number info\t' + tokens.ToA( sliceNumberToA ); } );

                pos += 1 + Math.ceil( numberLength / 2 );
            }

            TP_PID = octets[ pos ];
            tokenList.push( function(){ return '(hideable)Protocol Identifier\t' + tokens.PID( TP_PID ); } );

            pos++;
            TP_DCS = tokens.DCS( octets[ pos ] );
            tokenList.push( function(){ return '(hideable)Data Coding Scheme\t' + TP_DCS.info; } );

            pos++;
            var sliceTimeStamp = octets.slice( pos, pos + 7 );
            tokenList.push( function(){ return '(hideable)Service Centre Time Stamp\t' + tokens.SCTS( sliceTimeStamp ); } );

            pos += 6;
        }
        else if (pduType.type === 'submit') {
            pos++;
            var MR = octets[ pos ];
            tokenList.push( function() { return '(hideable)TP Message Reference\t' + tokens.MR( MR ); } );

            pos++;
            numberLength = parseInt( octets[ pos ], 16 );

            pos++;
            if (numberLength) {
                sliceNumber = octets.slice( pos + 1, pos + 1 + Math.ceil( numberLength / 2 ) );
                tokenList.push( function(){ return '(hideable)Number\t' + tokens.Number( sliceNumber, numberLength ); } );

                sliceNumberToA = octets[ pos ];
                tokenList.push( function(){ return '(hideable)Number info\t' + tokens.ToA( sliceNumberToA ); } );

                pos += 1 + Math.ceil( numberLength / 2 );
            }

            TP_PID = octets[ pos ];
            tokenList.push( function(){ return '(hideable)Protocol Identifier\t' + tokens.PID( TP_PID ); } );

            pos++;
            TP_DCS = tokens.DCS( octets[ pos ] );
            tokenList.push( function(){ return '(hideable)Data Coding Scheme\t' + TP_DCS.info; } );

            if (pduType.TP_VPF) {
                pos++;
                var sliceVP;
                if (pduType.TP_VPF === 'relative') {
                    sliceVP = octets[ pos ];
                    tokenList.push( function(){ return '(hideable)Validity Period\t' + tokens.VPrelative( sliceVP ); } );
                }
                else if (pduType.TP_VPF.match( /^(absolute|relative)$/ )) {
                    sliceVP = octets.slice( pos, pos + 7 );
                    tokenList.push( function(){ return '(hideable)Validity Period\tuntil ' + tokens.SCTS( sliceVP ); } );
                    pos += 6;
                }
            }
        }

        pos ++;
        var TP_UDL = tokens.UDL( octets[ pos ], TP_DCS.alphabet );
        tokenList.push( function(){ return 'User Data Length\t' + TP_UDL.info; } );

        var TP_UDHL = {};
        var TP_UDH = {};
        if (pduType.TP_UDHI) {
            pos++;
            TP_UDHL = tokens.UDHL( octets[ pos ], TP_DCS.alphabet );
            tokenList.push( function() { return 'User Data Header Length\t' + TP_UDHL.info; } );

            pos++;
            TP_UDH = tokens.UDH( octets.slice( pos, pos + TP_UDHL.length ) );
            tokenList.push( function() { return 'User Data Header\t' + TP_UDH.info; } );
            pos += TP_UDHL.length - 1;
        }

        pos++;
        var expectedMsgEnd = pos + TP_UDL.octets - (TP_UDHL.length ? TP_UDHL.length + 1 : 0);
        var sliceMessage = octets.slice( pos, expectedMsgEnd );

        if (TP_UDH.wap) {
            var wapMessage = wapDecoder( sliceMessage );
            tokenList.push( function(){ return 'User Data\tWireless Session Protocol (WSP) / WBXML ' + wapMessage; } );
        }
        else {
            tokenList.push( function(){ return 'User Data\t' + tokens.UD( sliceMessage, TP_DCS.alphabet, TP_UDHL.padding, TP_UDH.formatting ); } );

            if (expectedMsgEnd < octets.length) {
                tokenList.push( function(){ return 'VIOLATION\tPDU longer than expected!'; } );

                var sliceMessageAll = octets.slice( pos, octets.length );
                tokenList.push( function(){ return 'User Data /w additional stuff\t' + tokens.UD( sliceMessageAll, TP_DCS.alphabet, TP_UDHL.padding, TP_UDH.formatting ); } );

            }
            else if (expectedMsgEnd > octets.length) {
                tokenList.push( function(){ return 'VIOLATION\tPDU shorter than expected!'; } );
            }
        }

        return tokenList;
    }

    var tokens = {

        /**
         * Number token
         *
         * {@linkplain http://www.dreamfabric.com/sms/}
         *
         * @param {Array} octets containing a call number in BCD inverted nibble format
         * @param {Number} length expected length of number
         * @return Call number of sender, receiver, SMSC etc.
         * @type String
         */
        Number: function( octets, length ) {
            var i,
                number = '';

            for (i = 0; i < octets.length; ++i) {
                number += reverse( octets[ i ] );
            }

            if (number.match( /\D$/ ) || (length && number.length > length)) {
                var paddingEx = /(.)$/;
                var result = paddingEx.exec( number );

                number = number.substring( 0, number.length - 1 );

                if (result && result[1] && result[1] !== 'F') {
                    number += ' (VIOLATION: number not padded with "F" but with "' + result[1] + '"!)';
                }
            }

            return number;
        },

        /**
         * Type-of-Address token
         *
         * {@linkplain http://www.dreamfabric.com/sms/type_of_address.html}
         *
         * @param {String} octet ToA octet
         * @return Type-of-Address description text
         * @type String
         */
        ToA: function( octet ) {
            var type = parseInt( octet, 16 );

            var ToN = type & 0x70; // Type of number Bits
            var NPI = type & 0xF;	// Numbering Plan Identification

            var text = '';

            if (ToN === 0) {
                text += 'Unknown type of address';
            }
            else if (ToN === 0x10) {
                text += 'International number';
            }
            else if (ToN === 0x20) {
                text += 'National number';
            }
            else if (ToN === 0x30) {
                text += 'Network specific number';
            }
            else if (ToN === 0x40) {
                text += 'Subscriber number';
            }
            else if (ToN === 0x50) {
                text += 'Alphanumeric, (coded according to GSM TS 03.38 7-bit default alphabet)';
            }
            else if (ToN === 0x60) {
                text += 'Abbreviated number';
            }
            else if (ToN === 0x70) {
                text += 'Reserved for extension';
            }
            else {
                text += 'Reserved type of address';
            }

            text += ', ';

            if (NPI === 0) {
                text += 'Unknown';
            }
            else if (NPI === 1) {
                text += 'ISDN/telephone numbering plan (E.164/E.163)';
            }
            else if (NPI === 3) {
                text += 'IData numbering plan (X.121)';
            }
            else if (NPI === 4) {
                text += 'Telex numbering plan';
            }
            else if (NPI === 8) {
                text += 'National numbering plan';
            }
            else if (NPI === 9) {
                text += 'Private numbering plan';
            }
            else if (NPI === 0xA) {
                text += 'ERMES numbering plan (ETSI DE/PS 3 01-3)';
            }
            else if (NPI === 0xF) {
                text += 'Reserved for extension';
            }
            else {
                text += 'Reserved numbering plan';
            }

            if ((type & 0x80) === 0) {
                text += ' (VIOLATION: Highest bit should always be set!)';
            }

            return text;
        },

        /**
         * Type-of-Message Token
         *
         * (This function only recognizes SMS-DELIVER and SMS-SUBMIT, there are others!)
         *
         * {@linkplain http://www.dreamfabric.com/sms/deliver_fo.html}
         * {@linkplain http://www.dreamfabric.com/sms/submit_fo.html}
         *
         * @param {String} octet ToM octet
         * @return Object containing type string 'submit' or 'deliver', UDHI flag, VPF flag, PDU type description text
         * @type Object
         * @see UDHI token, VPF token
         */
        ToM: function( octet ) {
            var o = parseInt( octet, 16 );
            var TP_MTI_mask = 0x1; //0x3;
            var text = '';
            var flags = [];
            var deliver = false;
            var submit =false;
            var TP_VPF = null;
            var TP_UDHI = false;

            if ((o & TP_MTI_mask) === 0) {
                text += 'SMS-DELIVER';
                deliver = true;
            }
            else if ((o & TP_MTI_mask) === 1) {
                text += 'SMS-SUBMIT';
                submit = true;
            }
            else {
                console.debug( o, padwZeros( o.toString( 2 ) ) );
            }

            if (o & 0x80) {
                flags.push( 'TP-RP (Reply path exists)' );
            }
            if (o & 0x40) {
                TP_UDHI = true;
                flags.push( 'TP-UDHI (User data header indicator)' );
            }

            if (submit) {
                if (o & 0x20) {
                    flags.push( 'TP-SRR (Status report request)' );
                }


                var TP_VPF_mask = o & 0x18;
                var vpfText = 'TP-VPF (Validity Period Format): ';

                if (TP_VPF_mask === 0) {
                    // do nothing
                }
                else if (TP_VPF_mask === 8) {
                    TP_VPF = 'enhanced';
                    flags.push( vpfText + 'enhanced format' );
                }
                else if (TP_VPF_mask === 0x10) {
                    TP_VPF = 'relative';
                    flags.push( vpfText + 'relative format' );
                }
                else if (TP_VPF_mask === 0x18) {
                    TP_VPF = 'absolute';
                    flags.push( vpfText + 'absolute format' );
                }


                if ((o & 0x4) === 0) {
                    flags.push( 'TP-RD (Reject duplicates)' );
                }
            }
            else if (deliver) {
                if (o & 0x20) {
                    flags.push( 'TP-SRI (Status report indication)' );
                }

                if ((o & 0x4) === 0) {
                    flags.push( 'TP-MMS (More messages to send)' );
                }
            }

            if (flags.length) {
                text += ', Flags: ' + flags.join( ', ' );
            }


            return {
                type: deliver ? 'deliver' : (submit ? 'submit' : ''),
                TP_UDHI: TP_UDHI,
                TP_VPF: TP_VPF,
                info: text
            };
        },

        /**
         * Protocol IDentifier token
         *
         * {@linkplain http://www.dreamfabric.com/sms/pid.html}
         *
         * @param {String} octet PID octet
         * @return PID description text
         * @type String
         */
        PID: function( octet ) {
            var o = parseInt( octet, 16 );
            var text = '';
            var type = o & 0xC0;

            if (type === 0) {
                var firstFive = o & 0x1F;

                if (o & 0x20) {
                    text += 'Telematic interworking (Type: ';

                    if (firstFive === 0) {
                        text += 'implicit';
                    }
                    else if (firstFive === 1) {
                        text += 'telex';
                    }
                    else if (firstFive === 2) {
                        text += 'group 3 telefax';
                    }
                    else if (firstFive === 3) {
                        text += 'group 4 telefax';
                    }
                    else if (firstFive === 4) {
                        text += 'voice telephone - speech conversion';
                    }
                    else if (firstFive === 5) {
                        text += 'ERMES - European Radio Messaging System';
                    }
                    else if (firstFive === 6) {
                        text += 'National Paging System';
                    }
                    else if (firstFive === 7) {
                        text += 'Videotex - T.100/T.101';
                    }
                    else if (firstFive === 8) {
                        text += 'teletex, carrier unspecified';
                    }
                    else if (firstFive === 9) {
                        text += 'teletex, in PSPDN';
                    }
                    else if (firstFive === 0xA) {
                        text += 'teletex, in CSPDN';
                    }
                    else if (firstFive === 0xB) {
                        text += 'teletex, in analog PSTN';
                    }
                    else if (firstFive === 0xC) {
                        text += 'teletex, in digital ISDN';
                    }
                    else if (firstFive === 0xD) {
                        text += 'UCI - Universal Computer Interface, ETSI DE/PS 3 01-3';
                    }
                    else if (firstFive === 0x10) {
                        text += 'message handling facility known to the SC';
                    }
                    else if (firstFive === 0x11) {
                        text += 'public X.400-based message handling system';
                    }
                    else if (firstFive === 0x12) {
                        text += 'Internet E-Mail';
                    }
                    else if (firstFive >= 0x18 && firstFive <= 0x1E) {
                        text += 'SC specific value';
                    }
                    else if (firstFive === 0x1F) {
                        text += 'GSM mobile station';
                    }
                    else {
                        text += 'reserved';
                    }

                    text += ')';
                }
                else {
                    text += 'SME-to-SME protocol';

                    if (firstFive > 0) {
                        text += ' (Unknown bitmask: ' + firstFive.toString( 2 ) + '- in case of SMS-DELIVER these indicate the SM-AL protocol being used between the SME and the MS!)';
                    }
                }
            }
            else if (type === 0x40) {
                var firstSix = o & 0x3F;

                if (firstSix >= 0 && firstSix <= 7) {
                    text += 'Short Message Type ' + firstSix;
                }
                else if (firstSix === 0x1F) {
                    text += 'Return Call Message';
                }
                else if (firstSix === 0x3D) {
                    text += 'ME Data download';
                }
                else if (firstSix === 0x3E) {
                    text += 'ME De-personalization Short Message';
                }
                else if (firstSix === 0x3F) {
                    text += 'SIM Data download';
                }
                else {
                    text += 'reserved';
                }
            }
            else if (type === 0x80) {
                text += 'reserved';
            }
            else if (type === 0xC0) {
                text += 'SC specific use';
            }

            return text;
        },

        /**
         * Data Coding Scheme token
         *
         * {@linkplain http://www.dreamfabric.com/sms/dcs.html}
         *
         * @param {String} octet DCS octet
         * @return Object containing recognized alphabet, DCS description text
         * @type Object
         */
        DCS: function( octet ) {
            var o = parseInt( octet, 16 );
            var text = '';
            var alphabet = 'default';
            var codingGroup = o & 0xF0;

            if (codingGroup >= 0 && codingGroup <= 0x30) {
                text += 'General Data Coding groups, ';

                if (o & 0x20) {
                    text += 'compressed';
                }
                else {
                    text += 'uncompressed';
                }

                text += ', ';
                var alphabetFlag = o & 0xC;

                if (alphabetFlag === 0) {
                    text += 'default alphabet';
                }
                else if (alphabetFlag === 4) {
                    text += '8 bit data';
                    alphabet = '8bit';
                }
                else if (alphabetFlag === 8) {
                    text += 'UCS2 (16 bit)';
                    alphabet = 'ucs2';
                }
                else if (alphabetFlag === 0xC) {
                    text += 'reserved alphabet';
                }
            }
            else if (codingGroup >= 0x40 && codingGroup <= 0xB0) {
                text += 'Reserved coding groups';
            }
            else if (codingGroup === 0xC0) {
                text += 'Message Waiting Indication Group: Discard Message, ';
            }
            else if (codingGroup === 0xD0) {
                text += 'Message Waiting Indication Group: Store Message, standard encoding, ';
            }
            else if (codingGroup === 0xE0) {
                text += 'Message Waiting Indication Group: Store Message, UCS2 encoding, ';
            }
            else if (codingGroup === 0xF0) {
                text += 'Data coding/message class, ';

                if (o & 8) {
                    text += '(VIOLATION: reserved bit set, but should not!), ';
                }

                if (o & 4) {
                    text += '8 bit data';
                    alphabet = '8bit';
                }
                else {
                    text += 'Default alphabet';
                }
            }

            if ((codingGroup >= 0 && codingGroup <= 0x30) || codingGroup === 0xF0) {
                text += ', ';

                if ((codingGroup >= 0 && codingGroup <= 0x30) && (o & 0x10) === 0) {
                    text += ' no message class set (but given bits would be: ';
                }

                var msgClass = o & 3;

                text += 'Class ' + msgClass + ' - ';

                if (msgClass === 0) {
                    text += 'immediate display';
                }
                else if (msgClass === 1) {
                    text += 'ME specific';
                }
                else if (msgClass === 2) {
                    text += 'SIM specific';
                }
                else if (msgClass === 3) {
                    text += 'TE specific';
                }

                text += ')';

            }

            if (codingGroup >= 0xC0 && codingGroup <= 0xE0) {
                if (o & 8) {
                    text += 'Set Indication Active';
                }
                else {
                    text += 'Set Indication Inactive';
                }

                text += ', ';

                if (o & 4) {
                    text += '(reserved bit set, but should not!), ';
                }

                var indicationType = o & 3;

                if (indicationType === 0) {
                    text += 'Voicemail Message Waiting';
                }
                else if (indicationType === 1) {
                    text += 'Fax Message Waiting';
                }
                else if (indicationType === 2) {
                    text += 'E-Mail Message Waiting';
                }
                else if (indicationType === 3) {
                    text += 'Other Message Waiting (not yet standardized)';
                }
            }

            return {
                alphabet: alphabet,
                info: text
            };
        },

        /**
         * Service Center Time Stamp token
         *
         * {@linkplain http://www.dreamfabric.com/sms/scts.html}
         *
         * @param {Array} octets containing SCTS in BCD inverted nibble format
         * @return TimeStamp in format 'YYYY-MM-DD HH:MM:SS GMT +/-X'
         * @type String
         */
        SCTS: function( octets ) {
            var i;

            for (i = 0; i < 7; ++i) {
                octets[ i ] = reverse( octets[ i ] );
            }

            var ts = '';

            if (parseInt( octets[0], 10 ) < 70) {
                ts += '20';
            }
            else {
                ts += '19';
            }

            ts += octets[0] + '-' + octets[1] + '-' + octets[2] + ' ' + octets[3] + ':' + octets[4] + ':' + octets[5] + ' GMT ';

            var tz = parseInt( octets[6], 10 );

            if (tz & 0x80) {
                tz = tz & 0x7F;
                ts += '-';
            }
            else {
                ts += '+';
            }

            return ts + tz / 4;
        },

        /**
         * User Data Length token
         *
         * @param {String} octet UDL octet
         * @param {String} alphabet type
         * @return length by septets and octets, info text
         * @type Object
         */
        UDL: function( octet, alphabet ) {
            var o = parseInt( octet, 16 );
            var length = 0;
            var chars = o;

            if (alphabet === 'default') {
                length = Math.ceil( o * 70 / 80 );
            }
            else {
                length = o;
            }

            if (alphabet === 'ucs2') {
                chars = length / 2;
            }

            return {
                septets: o,
                octets: length,
                info: chars + ' characters, ' + length + ' bytes'
            };
        },

        /**
         * User Data Header Length token
         *
         * Evaluates the length of the User Data Header and the padding to the next septet start
         *
         * {@linkplain http://mobiletidings.com/2009/02/18/combining-sms-messages/}
         *
         * @param {String] octet UDHL octet
         * @param {String} alphabet type ('default', '8bit', 'ucs2')
         * @return UDH length in octets / bytes, padding in no. of bits, info text
         * @type Object
         */
        UDHL: function( octet, alphabet ) {
            var length = parseInt( octet, 16 );
            var padding = 0;

            if (alphabet === 'default') {
                var udhBitLength = (length + 1) * 8;
                var nextSeptetStart =  Math.ceil( udhBitLength / 7 ) * 7;

                padding = nextSeptetStart - udhBitLength;
            }

            return {
                length: length,
                padding: padding,
                info: length + ' bytes'
            };
        },

        /**
         * User Data Header token
         *
         * Recognizes some Information Elements (IE): concatenated SMS, usage of WAP protocol stack,
         * some well-known destination ports, some EMS text formatting
         *
         * {@linkplain http://mobiletidings.com/2009/02/18/combining-sms-messages/}
         * {@linkplain http://mobiletidings.com/2009/02/21/wap-push-over-sms-encodings/}
         * {@linkplain http://mobiletidings.com/2009/02/26/wap-push-over-sms-si-encoding/}
         * {@linkplain http://mobiletidings.com/2009/03/12/text-formatting-sms-ems/}
         * {@linkplain http://www.csoft.co.uk/sckl/index.htm}
         *
         * @param {Array} octets containing UDH
         * @return Wap indication, array of EMS text formatter callbacks, info text
         * @type Object
         */
        UDH: function( octets ) {
            var i,
                IEs = [],		// all Information Elements
                IE = {},		// actual Information Element
                info = [],
                text = '',
                isWap = false,
                destPort,
                isEMS = false,
                formatting = [],
                ems = [],
                style,
                format,
                color;

            // break up Information Elements
            while (octets.length) {
                var o = parseInt( octets.shift(), 16 );

                if (IE.IEI === undefined) {
                    IE.IEI = o;		// Information Element Identifier
                }
                else if (IE.IEDL === undefined) {
                    IE.IEDL = o;	// Information Element Data Length
                }
                else {
                    if (IE.IED === undefined) {
                        IE.IED = [];
                    }
                    IE.IED.push( o );

                    if (IE.IED.length >= IE.IEDL) {
                        IEs.push( IE );
                        IE = {};
                    }
                }
            }

            // Wireless Datagram Protocol IE
            for (i = 0; i < IEs.length; ++i) {
                if (IEs[ i ].IEI === 5) {
                    destPort = IEs[ i ].IED[0] * 256 + IEs[ i ].IED[1];

                    if (destPort === 5505) {
                        destPort += ' (Ring Tone)';
                    }
                    else if (destPort === 5506) {
                        destPort += ' (Operator Logo)';
                    }
                    else if (destPort === 5507) {
                        destPort += ' (Group Graphic - CLI Logo)';
                    }
                    else if (destPort === 9200) {
                        destPort += ' (Connectionless WAP browser proxy server)';
                    }
                    else if (destPort === 9202) {
                        destPort += ' (Secure connectionless WAP browser proxy server)';
                    }
                    else if (destPort === 9203) {
                        destPort += ' (Secure WAP Browser proxy server)';
                    }
                    else if (destPort === 9204) {
                        destPort += ' (vCard)';
                    }
                    else if (destPort === 9205) {
                        destPort += ' (vCalendar)';
                    }
                    else if (destPort === 9206) {
                        destPort += ' (Secure vCard)';
                    }
                    else if (destPort === 9207) {
                        destPort += ' (Secure vCalendar)';
                    }
                    else {
                        isWap = true;
                    }

                    text = 'WDP (Wireless Datagram Protocol): Destination port is ' + destPort + ', source port is ' + (IEs[ i ].IED[2] * 256 + IEs[ i ].IED[3]);

                    if (IEs[ i ].IEDL !== 4) {
                        text += ' (VIOLATON: This Information Element should have exactly 4 bytes but says it has ' + IEs[ i ].IEDL + ' instead!)';
                    }
                    if (IEs[i].IED.length !== 4) {
                        text += ' (VIOLATION: This Information Element should have exactly 4 bytes but actually has ' + IEs[i].IED.length + ' instead!)';
                    }

                    info.push( text );
                }

                // Concatenation IE
                else if (IEs[ i ].IEI === 0) {
                    text = 'Concatenated message: reference number ' + IEs[ i ].IED[0] + ', part ' + IEs[ i ].IED[2] + ' of ' + IEs[ i ].IED[1] + ' parts';

                    if (IEs[ i ].IEDL !== 3) {
                        text += ' (VIOLATON: This Information Element should have exactly 3 bytes but says it has ' + IEs[ i ].IEDL + ' instead!)';
                    }
                    if (IEs[i].IED.length !== 3) {
                        text += ' (VIOLATION: This Information Element should have exactly 3 bytes but actually has ' + IEs[i].IED.length + ' instead!)';
                    }

                    info.push( text );
                }

                // EMS formatting IE
                else if (IEs[ i ].IEI === 10) {
                    isEMS = true;

                    style = [];
                    format = IEs[ i ].IED[2];


                    if ((format & 3) === 1) {
                        style.push( 'text-align: center' );
                    }
                    else if ((format & 3) === 2) {
                        style.push( 'text-align: right' );
                    }

                    if ((format & 0xC) === 4) {
                        style.push( 'font-size: large' );
                    }
                    else if ((format & 0xC) === 8) {
                        style.push( 'font-size: small' );
                    }

                    if (format & 0x20) {
                        style.push( 'font-style: italic' );
                    }

                    if (format & 0x10) {
                        style.push( 'font-weight: bold' );
                    }

                    if (format & 0x40) {
                        style.push( 'text-decoration: underline' );
                    }

                    if (format & 0x80) {
                        style.push( 'text-decoration: line-through' );
                    }

                    color = IEs[ i ].IED[3];

                    if (color) {
                        if ((color & 0xF) === 1) {
                            style.push( 'color: darkGray' );
                        }
                        else if ((color & 0xF) === 2) {
                            style.push( 'color: darkRed' );
                        }
                        else if ((color & 0xF) === 3) {
                            style.push( 'color: GoldenRod' );
                        }
                        else if ((color & 0xF) === 4) {
                            style.push( 'color: darkGreen' );
                        }
                        else if ((color & 0xF) === 5) {
                            style.push( 'color: darkCyan' );
                        }
                        else if ((color & 0xF) === 6) {
                            style.push( 'color: darkBlue' );
                        }
                        else if ((color & 0xF) === 7) {
                            style.push( 'color: darkMagenta' );
                        }
                        else if ((color & 0xF) === 8) {
                            style.push( 'color: gray' );
                        }
                        else if ((color & 0xF) === 9) {
                            style.push( 'color: white' );
                        }
                        else if ((color & 0xF) === 0xA) {
                            style.push( 'color: red' );
                        }
                        else if ((color & 0xF) === 0xB) {
                            style.push( 'color: yellow' );
                        }
                        else if ((color & 0xF) === 0xC) {
                            style.push( 'color: green' );
                        }
                        else if ((color & 0xF) === 0xD) {
                            style.push( 'color: cyan' );
                        }
                        else if ((color & 0xF) === 0xE) {
                            style.push( 'color: blue' );
                        }
                        else if ((color & 0xF) === 0xF) {
                            style.push( 'color: magenta' );
                        }

                        if ((color & 0xF0) === 0) {
                            style.push( 'background-color: black' );
                        }
                        else if ((color & 0xF0) === 0x10) {
                            style.push( 'background-color: darkGray' );
                        }
                        else if ((color & 0xF0) === 0x20) {
                            style.push( 'background-color: darkRed' );
                        }
                        else if ((color & 0xF0) === 0x30) {
                            style.push( 'background-color: GoldenRod' );
                        }
                        else if ((color & 0xF0) === 0x40) {
                            style.push( 'background-color: darkGreen' );
                        }
                        else if ((color & 0xF0) === 0x50) {
                            style.push( 'background-color: darkCyan' );
                        }
                        else if ((color & 0xF0) === 0x60) {
                            style.push( 'background-color: darkBlue' );
                        }
                        else if ((color & 0xF0) === 0x70) {
                            style.push( 'background-color: darkMagenta' );
                        }
                        else if ((color & 0xF0) === 0x80) {
                            style.push( 'background-color: gray' );
                        }
                        else if ((color & 0xF0) === 0x90) {
                            style.push( 'background-color: white' );
                        }
                        else if ((color & 0xF0) === 0xA0) {
                            style.push( 'background-color: red' );
                        }
                        else if ((color & 0xF0) === 0xB0) {
                            style.push( 'background-color: yellow' );
                        }
                        else if ((color & 0xF0) === 0xC0) {
                            style.push( 'background-color: green' );
                        }
                        else if ((color & 0xF0) === 0xD0) {
                            style.push( 'background-color: cyan' );
                        }
                        else if ((color & 0xF0) === 0xE0) {
                            style.push( 'background-color: blue' );
                        }
                        else if ((color & 0xF0) === 0xF0) {
                            style.push( 'background-color: magenta' );
                        }
                    }

                    if (style.length) {
                        IEs[ i ].markupOpen = '<span style="' + style.join( '; ' ) + '">';
                        IEs[ i ].markupClose = '</span>';
                    }
                    else {
                        IEs[ i ].markupOpen = '';
                        IEs[ i ].markupClose = '';
                    }

                    ems.push( IEs[ i ] );

                    formatting.push( function( text, original, i ) {
                        original = original.substr( ems[ i ].IED[0], ems[ i ].IED[1] );

                        var getPart = new RegExp( original );

                        return text.replace( getPart, ems[ i ].markupOpen + original + ems[ i ].markupClose );
                    } );

                }
            }

            if (isEMS) {
                info.push( 'has EMS formatting' );
            }

            return {wap: isWap, formatting: formatting, info: info.join( '; ' )};
        },

        /**
         * User Data token
         *
         * Tries to decode the user data:
         * - default 7 Bit charset
         * - UCS2 2 byte decoding
         * - Fallback to ASCII decoding, often one can see some useful information there (e.g. name of wallpaper)
         *
         * {@linkplain http://www.dreamfabric.com/sms/hello.html}
         *
         * @param {Array} octets
         * @param {String} alphabet type ('default', '8bit', 'ucs2')
         * @param {Number} padding induced by UDH (optional)
         * @param {Array} formatting EMS formatter callbacks
         * @return Decoded user data
         * @type String
         */
        UD: function( octets, alphabet, padding, formatting ) {
            var thisAndNext;
            var thisChar;
            var nextChar = '';
            var text = '';
            var i = 0;
            var original;
            var character;

            if (alphabet === 'default') {
                if (padding && octets.length) {
                    nextChar = padwZeros( parseInt( octets.shift(), 16 ).toString( 2 ) );
                    nextChar = nextChar.substring( 0, nextChar.length - padding );
                }

                while (octets.length) {
                    thisAndNext = getChar( octets, nextChar );
                    thisChar = thisAndNext[0];
                    nextChar = thisAndNext[1];
                    character = gsm7bit[ parseInt( thisChar, 2 ) ];

                    // Extension table on 0x1B
                    if (typeof character === 'object') {
                        thisAndNext = getChar( octets, nextChar );
                        thisChar = thisAndNext[0];
                        nextChar = thisAndNext[1];
                        character = character[ parseInt( thisChar, 2 ) ];
                    }

                    text += character ? character : '';
                }
            }
            else if (alphabet === 'ucs2') {
                while (octets.length) {
                    thisChar = octets.shift() + octets.shift();
                    text += String.fromCharCode( parseInt( thisChar, 16 ) );
                }
            }
            else {
                text += '(';

                if (alphabet === '8bit') {
                    text += 'unknown binary data';
                }
                else {
                    text += 'unrecognized alphpabet';
                }

                text += ', try ASCII decoding) ';

                while (octets.length) {
                    text += String.fromCharCode( parseInt( octets.shift(), 16 ) );
                }
            }

            // Execute EMS formatting
            if (formatting && formatting.length) {
                original = text;
                for (i = 0; i < formatting.length; i++) {
                    text = formatting[ i ]( text, original, i );
                }
            }

            return text;
        },

        /**
         * Message Reference token (only on PDU type 'submit')
         *
         * @param {String} octet
         * @return Info text
         * @type String
         */
        MR: function( octet ) {
            if (octet === '00') {
                return 'Mobile equipment sets reference number';
            }
            return '0x' + octet;
        },

        /**
         * Validity Period token (only on PDU type 'submit')
         * This only handles the relative type, absolute and enhanced are timestamps like SCTS
         *
         * {@linkplain http://www.dreamfabric.com/sms/vp.html}
         *
         * @param {String} octet
         * @return info text
         * @type String
         */
        VPrelative: function( octet ) {
            var vp = parseInt( octet, 16 );
            var text = '';

            if (vp < 144) {
                text = ((vp + 1) * 5) + ' minutes';
            }
            else if (vp > 143 && vp < 168) {
                text = ((vp - 143) * 30 / 60 + 12) + ' hours';
            }
            else if (vp > 167 && vp < 197) {
                text = (vp - 166 ) + ' days';
            }
            else if (vp > 186) {
                text = (vp - 192) + ' weeks';
            }

            return text;
        }

    };

    /**
     * Decodes septets-in-octets encoding of the GSM 7 Bit character set
     *
     * @param {Array} octets
     * @param {String} nextChar
     * @return 7 digit bitstream string representing the current decoded character and parts of the next one.
     * @type [ String, String ]
     */
    function getChar( octets, nextChar ) {
        if (nextChar.length === 7) {
            return [nextChar, ''];
        }

        var octet = padwZeros( parseInt( octets.shift(), 16 ).toString( 2 ) );
        var bitsFromNextChar = nextChar.length + 1;
        var thisChar = octet.substr( bitsFromNextChar ) + nextChar;
        nextChar = octet.substr( 0, bitsFromNextChar );

        return [thisChar, nextChar];
    }

    /**
     * Reverse an octet
     *
     * Used to decode BCD inversed nibbles format
     *
     * @param {String} octet
     * @return Reversed octet
     * @type String
     */
    function reverse( octet ) {
        if (typeof octet === 'string') {
            return octet.substr( 1, 1 ) + octet.substr( 0, 1 );
        }
        else {
            return '00';
        }
    }

    /**
     * Pads a bitsream in a string with zeros as long as its shorter than 8 digits
     *
     * @param {String} bitstream
     * @return a Zero-padded binary bitstream
     * @type String
     */
    function padwZeros( bitstream ) {
        while (bitstream.length < 8) {
            bitstream = '0' + bitstream;
        }

        return bitstream;
    }

    /**
     * GSM 7 bit default alphabet lookup table
     *
     * {@linkplain http://www.dreamfabric.com/sms/default_alphabet.html}
     */
    var gsm7bit = {
        0: '@', 1: '£', 2: '$', 3: '¥', 4: 'è', 5: 'é', 6: 'ù', 7: 'ì', 8: 'ò', 9: 'Ç',
        10:'\n', 11: 'Ø', 12: 'ø', 13: '\r', 14: 'Å', 15: 'å', 16: '\u0394', 17: '_', 18: '\u03a6', 19: '\u0393',
        20: '\u039b', 21: '\u03a9', 22: '\u03a0', 23: '\u03a8', 24: '\u03a3', 25: '\u0398', 26: '\u039e', 28: 'Æ', 29: 'æ',
        30: 'ß', 31: 'É', 32: ' ', 33: '!', 34: '"', 35: '#', 36: '¤', 37: '%', 38: '&', 39: '\'',
        40: '(', 41: ')', 42: '*', 43: '+', 44: ',', 45: '-', 46: '.', 47: '/', 48: '0', 49: '1',
        50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9', 58: ':', 59: ';',
        60: '<', 61: '=', 62: '>', 63: '?', 64: '¡', 65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E',
        70: 'F', 71: 'G', 72: 'H', 73: 'I', 74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O',
        80: 'P', 81: 'Q', 82: 'R', 83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y',
        90: 'Z', 91: 'Ä', 92: 'Ö', 93: 'Ñ', 94: 'Ü', 95: '§', 96: '¿', 97: 'a', 98: 'b', 99: 'c',
        100: 'd', 101: 'e', 102: 'f', 103: 'g', 104: 'h', 105: 'i', 106: 'j', 107: 'k', 108: 'l', 109: 'm',
        110: 'n', 111: 'o', 112: 'p', 113: 'q', 114: 'r', 115: 's', 116: 't', 117: 'u', 118: 'v', 119: 'w',
        120: 'x', 121: 'y', 122: 'z', 123: 'ä', 124: 'ö', 125: 'ñ', 126: 'ü', 127: 'à',
        27: {
            10: '\n', // Should be FORM-FEED but no good here
            20: '^', 40: '{', 41: '}', 47: '\\',
            60: '[', 61: '~', 62: ']', 64: '|', 101: '&#8364;'
        }
    };

    /**
     * wapDecoder decodes some parts of the WAP stack (WBXML / WSP / WDP) contained in SMS
     *
     * {@linkplain http://mobiletidings.com/2009/02/21/wap-push-over-sms-encodings/}
     *
     * @param octets
     * @return HTML table containing all decoded information
     * @type String
     */
    function wapDecoder( octets ) {
        var i,
            pos = 0,
            data = [],
            dataStr = '';

        data.push( 'WSP Transaction ID\t0x' + octets[ pos ] );

        pos++;
        data.push( 'Type\t' + wapTokens.type( octets[ pos ] ) );

        pos++;
        var headerLength = parseInt( octets[ pos ], 16 );
        pos++;
        data.push( 'Wireless Session Protocol\t' + wapTokens.WSP( octets.slice( pos, pos + headerLength ) ) );

        pos += headerLength;

        data.push( 'WAP Binary XML\t' + wapTokens.WBXML( octets.slice( pos ) ) );


        for (i = 0; i < data.length; ++i) {
            dataStr += '<tr><td>' + data[ i ].replace( /\t/, '</td><td>' ) + '</td></tr>';
        }


        return '<table><tbody>' + dataStr + '</tbody></table>';
    }

    var wapTokens = {

        /**
         * Type token
         *
         * {@linkplain http://mobiletidings.com/2009/02/21/wap-push-over-sms-encodings/}
         *
         * @param {String} octet
         * @return type of WAP encoded message
         * @type String
         */
        type: function( octet ) {
            if (octet === 6) {
                return 'Push';
            }
            return 'unknown';
        },

        /**
         * Wireless Session Protocol token
         *
         * Decodes a WSP header - at least all the information i could get a grip on.
         *
         * {@linkplain http://mobiletidings.com/2009/02/21/wap-push-over-sms-encodings/}
         * {@linkplain http://mobiletidings.com/2009/02/26/wap-push-over-sms-si-encoding/#comment-1216}
         *
         * @param {Array} octets
         * @return Information text
         * @type String
         */
        WSP: function( octets ) {
            var i,
                o,
                text = '',
                headers = [],
                header = {},
                wellKnown;

            while (octets.length) {
                o = parseInt( octets.shift(), 16 );

                // 0 is either a string terminator, somewhere in between
                // or indicate a 0-length header (which shouldn't really happen)
                // -> do nothing on 0, just increase counter
                if (o === 0 && header.octets) {
                    header.pos++;
                }

                if (o > 0 && o < 32) { // start of next header
                    if (header.octets) { // there is an unfinished header left -> this indicates a illegal WSP header
                        headers.push( header );
                    }

                    header = {
                        key: '',
                        value: '',
                        pos: 0,
                        octets: o // the next 0 - 30 octets are the data
                    };

                    if (o === 31) { // special case: length is in next octet
                        header.octets = parseInt( octets.shift(), 16 );
                    }

                    if (headers.length === 0) {
                        header.key = 'Content-Type'; // first WSP header has to be content type
                    }
                }
                else if (o > 31 && o < 128) { // this is a character
                    header.value += String.fromCharCode( o );
                    header.pos++;
                }
                else if (o > 127) {
                    wellKnown = o & 0x7f;

                    if (wellKnown === 0x01) {
                        header.value += '; charset=';
                    }
                    else if (wellKnown === 0x30) {
                        header.value += 'application/vnd.wap.slc';
                    }
                    else if (wellKnown === 0x2e) {
                        header.value += 'application/vnd.wap.sic';
                    }
                    else if (wellKnown === 0x6A) {
                        header.value += 'UTF-8';
                    }

                    header.pos++;
                }

                if (header.pos >= header.octets) {
                    headers.push( header );
                    header = {
                        key: '',
                        value: '',
                        pos: 0,
                        octets: 0
                    };
                }
            }

            for (i = 0; i < headers.length; i++) {
                text += headers[ i ].key + ': ' + headers[ i ].value;
            }

            return text;
        },

        /**
         * WAP Binary XML token
         *
         * Invoces a server-side decoder.
         * Since XML markup should be returned, it's probably safe to asume that if the
         * return value doesn't contain a '&', the decoding failed.
         * If this happens, a fallback ASCII decoding will take place.
         *
         * {@linkplain http://libwbxml.aymerick.com/}
         * {@linkplain http://search.cpan.org/~glasser/XML-WBXML-0.03/lib/XML/WBXML.pm}
         * {@linkplain http://mobiletidings.com/2009/02/21/wap-push-over-sms-encodings/}
         *
         * @param {Array} octets
         * @return Decoded WPBXML message
         * @type String
         */
        WBXML: function( octets ) {
            var i,
                text = '';

            for (i = 0; i < octets.length; ++i) {
                text += octets[ i ];
            }

            $.ajax( {
                async: false,
                cache: false,
                data: {octets: text},
                timeout: 1000,
                url: 'wbxml.pl',
                success: function( xml ) {
                    text = xml.replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /&/g, '&amp;' );
                }
            } );

            if (!text.match( /&/ )) {
                text += ' (Could not be decoded, try ASCII decoding)';

                while (octets.length) {
                    text += String.fromCharCode( parseInt( octets.shift(), 16 ) );
                }
            }

            return text;
        }

    };

    /**
     * Sets form values from URI query paramater values
     *
     * @return true if anything was changed
     * @type Boolean
     */
    function setForm() {
        var query = document.location.search.substr( 1 ).split( '&' );
        var params = {};
        var i;
        var p;
        var $fields;
        var re = {
            textarea: /^TEXTAREA$/i,
            input: /^INPUT$/i,
            text: /^text$/i,
            checkbox_radio: /^(checkbox|radio)$/i
        };
        var changed = false;

        for (i = 0; i < query.length; ++i) {
            p = query[ i ].split( '=' );

            if (!params[ p[0] ]) {
                params[ p[0] ] = p[1];
            }
            else {
                params[ p[0] ] = [params[ p[0] ], p[1]];
            }
        }

        for (i in params) {
            if (params.hasOwnProperty( i )) {
                $fields = $( '[name=' + i + ']' );

                $fields.each( function() {
                    if (this.tagName.match( re.textarea ) || (this.tagName.match( re.input ) && this.type.match( re.text ))) {
                        this.value = params[ i ];
                        changed = true;
                    }

                    else if (this.tagName.match( re.input ) && this.type.match( re.checkbox_radio ) && this.value === params[ i ]) {
                        this.checked = true;
                        $( this ).change();
                        changed = true;
                    }
                } );
            }
        }

        return changed;
    }

    /**
     * Removes all whitespaces, linebreaks etc. from a form field content
     *
     * @param field a form field DOM element
     */
    function cleanInput( field ) {
        var $field = $( field );

        $field.val( $field.val().replace( /\s/g, '' ) );
    }

}());