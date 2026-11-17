"""
Makes the test mark-certificate PKI the BIMI tests use (lib/__tests__/bimi-certificate.test.ts):
a root, an intermediate with the BIMI key purpose, leaves with and without
each required extension, and a CRL from the intermediate that revokes
leaf-revoked. Needs OpenSSL 3.4 or newer.

    python generate.py <new empty directory>

Copy the .pem files (never the keys) back here. The certificates run from
2026 to 2036; the tests pin the time they check at.

cnn-vmc.pem is not made here: it is CNN's real VMC from DigiCert, as its
BIMI record served it in October 2026.
"""
import base64, gzip, hashlib, os, subprocess, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=False)
os.chdir(out)


def run(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(args), r.stderr)
        sys.exit(1)
    return r.stdout


def tlv(tag, content):
    n = len(content)
    if n < 0x80:
        length = bytes([n])
    else:
        b = n.to_bytes((n.bit_length() + 7) // 8, 'big')
        length = bytes([0x80 | len(b)]) + b
    return bytes([tag]) + length + content


def oid(s):
    p = [int(x) for x in s.split('.')]
    body = bytes([40 * p[0] + p[1]])
    for v in p[2:]:
        enc = [v & 0x7f]
        v >>= 7
        while v:
            enc.append(0x80 | (v & 0x7f))
            v >>= 7
        body += bytes(reversed(enc))
    return tlv(0x06, body)


SVG = b'<svg version="1.2" baseProfile="tiny-ps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Brand Example</title><rect width="100" height="100" fill="#0a6"/></svg>'
gz = gzip.compress(SVG, mtime=0)
uri = b'data:image/svg+xml;base64,' + base64.b64encode(gz)
hav = tlv(0x30, tlv(0x30, oid('2.16.840.1.101.3.4.2.1') + b'\x05\x00') + tlv(0x04, hashlib.sha256(gz).digest()))
details = tlv(0x30, tlv(0x16, b'image/svg+xml') + tlv(0x30, hav) + tlv(0x30, tlv(0x16, uri)))
image = tlv(0x30, details)
logotype = tlv(0x30, tlv(0xa2, tlv(0xa0, tlv(0x30, image))))
LOGO = logotype.hex()
SCT = tlv(0x04, b'\x00\x00').hex()
BIMI = '1.3.6.1.5.5.7.3.31'

with open('openssl.cnf', 'w') as f:
    f.write(f"""
oid_section = new_oids
[ new_oids ]
markType = 1.3.6.1.4.1.53087.1.13
[ req ]
distinguished_name = dn
prompt = no
[ dn ]
CN = placeholder
[ root_ext ]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[ int_ext ]
basicConstraints = critical,CA:true,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
extendedKeyUsage = {BIMI}
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[ leaf_ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = {BIMI}
subjectAltName = DNS:brand.example
crlDistributionPoints = URI:http://crl.brand-ca.test/vmc.crl
1.3.6.1.5.5.7.1.12 = DER:{LOGO}
1.3.6.1.4.1.11129.2.4.2 = DER:{SCT}
authorityKeyIdentifier = keyid
[ leaf_selector_ext ]
basicConstraints = critical,CA:false
extendedKeyUsage = {BIMI}
subjectAltName = DNS:brand._bimi.brand.example
crlDistributionPoints = URI:http://crl.brand-ca.test/vmc.crl
1.3.6.1.5.5.7.1.12 = DER:{LOGO}
1.3.6.1.4.1.11129.2.4.2 = DER:{SCT}
[ leaf_no_sct_ext ]
basicConstraints = critical,CA:false
extendedKeyUsage = {BIMI}
subjectAltName = DNS:brand.example
1.3.6.1.5.5.7.1.12 = DER:{LOGO}
[ leaf_no_logo_ext ]
basicConstraints = critical,CA:false
extendedKeyUsage = {BIMI}
subjectAltName = DNS:brand.example
1.3.6.1.4.1.11129.2.4.2 = DER:{SCT}
[ leaf_server_ext ]
basicConstraints = critical,CA:false
extendedKeyUsage = serverAuth
subjectAltName = DNS:brand.example
1.3.6.1.5.5.7.1.12 = DER:{LOGO}
1.3.6.1.4.1.11129.2.4.2 = DER:{SCT}
[ ca ]
default_ca = int_ca
[ int_ca ]
database = index.txt
crlnumber = crlnumber
default_md = sha256
default_crl_days = 3650
""")
open('index.txt', 'w').close()
with open('crlnumber', 'w') as f:
    f.write('01\n')


def cert(name, subj, issuer, ext, nb='20260101000000Z', na='20360101000000Z', serial=None):
    run('openssl', 'genrsa', '-out', f'{name}.key', '2048')
    run('openssl', 'req', '-new', '-key', f'{name}.key', '-subj', subj, '-out', f'{name}.csr', '-config', 'openssl.cnf')
    args = ['openssl', 'x509', '-req', '-in', f'{name}.csr', '-out', f'{name}.pem', '-extfile', 'openssl.cnf',
            '-extensions', ext, '-not_before', nb, '-not_after', na, '-sha256',
            '-set_serial', serial or str(int.from_bytes(os.urandom(8), 'big'))]
    if issuer:
        args += ['-CA', f'{issuer}.pem', '-CAkey', f'{issuer}.key']
    else:
        args += ['-key', f'{name}.key']
    run(*args)


cert('root', '/C=XX/O=Test Mark Authority/CN=Test Verified Mark Root', None, 'root_ext')
cert('other-root', '/C=XX/O=Other Authority/CN=Test Verified Mark Root', None, 'root_ext')
cert('intermediate', '/C=XX/O=Test Mark Authority/CN=Test Verified Mark CA', 'root', 'int_ext')
LEAF = '/C=XX/O=Brand Example Ltd/CN=Brand Example Ltd/markType=Registered Mark'
cert('leaf', LEAF, 'intermediate', 'leaf_ext')
cert('leaf-cmc', '/C=XX/O=Brand Example Ltd/CN=Brand Example Ltd/markType=Prior Use Mark', 'intermediate', 'leaf_ext')
cert('leaf-selector', LEAF, 'intermediate', 'leaf_selector_ext')
cert('leaf-no-sct', LEAF, 'intermediate', 'leaf_no_sct_ext')
cert('leaf-no-logo', LEAF, 'intermediate', 'leaf_no_logo_ext')
cert('leaf-server', LEAF, 'intermediate', 'leaf_server_ext')
cert('leaf-expired', LEAF, 'intermediate', 'leaf_ext', nb='20240101000000Z', na='20250101000000Z')
cert('leaf-revoked', LEAF, 'intermediate', 'leaf_ext', serial='0x0BADC0DE')
cert('leaf-other', LEAF, 'other-root', 'leaf_ext')
run('openssl', 'ca', '-config', 'openssl.cnf', '-revoke', 'leaf-revoked.pem', '-keyfile', 'intermediate.key', '-cert', 'intermediate.pem')
run('openssl', 'ca', '-config', 'openssl.cnf', '-gencrl', '-keyfile', 'intermediate.key', '-cert', 'intermediate.pem', '-out', 'intermediate.crl.pem')
run('openssl', 'crl', '-in', 'intermediate.crl.pem', '-outform', 'DER', '-out', 'intermediate.crl')
print(run('openssl', 'x509', '-in', 'leaf.pem', '-noout', '-text')[:1800])
