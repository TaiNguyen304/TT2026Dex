/**
 * Client-Side Asymmetric Crypto Helper
 * Provides RSA-OAEP + AES-GCM hybrid asymmetric decryption for Player and Viewer clients.
 * Protects question and answer data from being inspected via F12 -> Network -> Socket -> Messages.
 */
(function (window) {
    let clientKeyPair = null;
    let clientPublicKeySpki = null;
    let initPromise = null;
    let serverPublicKeySpki = null;

    /**
     * Initializes RSA-OAEP key pair (2048-bit, SHA-256)
     */
    async function initClientCrypto() {
        if (initPromise) return initPromise;

        initPromise = (async () => {
            if (!window.crypto || !window.crypto.subtle) {
                console.warn('[AsymCrypto] Web Crypto API is not supported in this browser.');
                return null;
            }

            try {
                clientKeyPair = await window.crypto.subtle.generateKey(
                    {
                        name: "RSA-OAEP",
                        modulusLength: 2048,
                        publicExponent: new Uint8Array([1, 0, 1]),
                        hash: "SHA-256"
                    },
                    true,
                    ["encrypt", "decrypt"]
                );

                const spkiBuf = await window.crypto.subtle.exportKey("spki", clientKeyPair.publicKey);
                let binary = '';
                const bytes = new Uint8Array(spkiBuf);
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                clientPublicKeySpki = btoa(binary);
                console.log('[AsymCrypto] RSA-OAEP Key Pair generated successfully for client socket security.');
                return clientPublicKeySpki;
            } catch (err) {
                console.error('[AsymCrypto] Failed to initialize client crypto:', err);
                return null;
            }
        })();

        return initPromise;
    }

    /**
     * Gets the client's public key (SPKI base64 format)
     */
    async function getClientPublicKey() {
        if (!clientPublicKeySpki) {
            await initClientCrypto();
        }
        return clientPublicKeySpki;
    }

    /**
     * Decrypts a single encrypted payload object
     */
    async function decryptSinglePacket(packet) {
        if (!packet || typeof packet !== 'object' || !packet.__asymEnc) {
            return packet;
        }
        if (!clientKeyPair) {
            await initClientCrypto();
        }
        if (!clientKeyPair || !clientKeyPair.privateKey) {
            return packet;
        }

        try {
            // 1. Decrypt AES key with RSA-OAEP private key
            const encKeyBytes = Uint8Array.from(atob(packet.encKey), c => c.charCodeAt(0));
            const aesKeyBuf = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                clientKeyPair.privateKey,
                encKeyBytes
            );

            // 2. Import AES-GCM key
            const aesKey = await window.crypto.subtle.importKey(
                "raw",
                aesKeyBuf,
                { name: "AES-GCM" },
                false,
                ["decrypt"]
            );

            // 3. Decrypt ciphertext (data + auth tag)
            const dataBytes = Uint8Array.from(atob(packet.data), c => c.charCodeAt(0));
            const tagBytes = Uint8Array.from(atob(packet.tag), c => c.charCodeAt(0));
            const combined = new Uint8Array(dataBytes.length + tagBytes.length);
            combined.set(dataBytes, 0);
            combined.set(tagBytes, dataBytes.length);

            const ivBytes = Uint8Array.from(atob(packet.iv), c => c.charCodeAt(0));
            const decryptedBuf = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: ivBytes,
                    tagLength: 128
                },
                aesKey,
                combined
            );

            const jsonStr = new TextDecoder().decode(decryptedBuf);
            return JSON.parse(jsonStr);
        } catch (err) {
            console.error('[AsymCrypto] Error decrypting incoming socket message:', err);
            return packet;
        }
    }

    /**
     * Decrypts recursively (handles whole-packet or individual encrypted fields)
     */
    async function decryptMessage(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        if (data.__asymEnc) {
            return await decryptSinglePacket(data);
        }
        if (Array.isArray(data)) {
            return await Promise.all(data.map(item => decryptMessage(item)));
        }
        const result = {};
        for (const [key, val] of Object.entries(data)) {
            result[key] = await decryptMessage(val);
        }
        return result;
    }

    /**
     * Wraps a Socket.IO client socket to transparently decrypt all incoming events
     * and attach public key to joinRoom
     */
    function setupSecureSocket(socket) {
        if (!socket || socket.__isSecureWrapped) return socket;
        socket.__isSecureWrapped = true;

        // Intercept socket.on
        const originalOn = socket.on.bind(socket);
        socket.on = function (eventName, callback) {
            return originalOn(eventName, async function (...args) {
                try {
                    const decryptedArgs = await Promise.all(args.map(arg => decryptMessage(arg)));
                    callback.apply(this, decryptedArgs);
                } catch (err) {
                    console.error(`[AsymCrypto] Error processing event '${eventName}':`, err);
                    callback.apply(this, args);
                }
            });
        };

        // Intercept socket.emit for joinRoom to automatically include publicKey
        const originalEmit = socket.emit.bind(socket);
        socket.emit = function (eventName, ...args) {
            if (eventName === 'joinRoom') {
                const roomData = args[0] || {};
                const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;

                // Ensure public key is included
                getClientPublicKey().then(pubKey => {
                    if (pubKey) {
                        roomData.publicKey = pubKey;
                    }

                    if (callback) {
                        // Wrap callback to decrypt response if encrypted
                        args[args.length - 1] = async function (res) {
                            if (res && res.gameState) {
                                res.gameState = await decryptMessage(res.gameState);
                            }
                            if (res && res.serverPublicKey) {
                                serverPublicKeySpki = res.serverPublicKey;
                            }
                            callback(res);
                        };
                    }

                    originalEmit.apply(socket, [eventName, ...args]);
                }).catch(() => {
                    originalEmit.apply(socket, [eventName, ...args]);
                });

                return socket;
            }

            return originalEmit.apply(socket, [eventName, ...args]);
        };

        return socket;
    }

    // Export API to window
    window.AsymCrypto = {
        init: initClientCrypto,
        getPublicKey: getClientPublicKey,
        decrypt: decryptMessage,
        setupSecureSocket: setupSecureSocket
    };

    // Automatically trigger key generation as early as possible
    initClientCrypto().catch(() => {});
})(window);
