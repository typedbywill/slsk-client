const net = require('net')
const debug = require('debug')('slsk:peer:file')
const MessageFactory = require('../message-factory.js')

let stack = require('../stack')

/**
 * Inicia o download de um arquivo de um peer, retornando o Buffer de dados via callback.
 * O salvamento no filesystem foi removido.
 *
 * @param {string} host - Endereço IP do peer.
 * @param {number} port - Porta do peer.
 * @param {string} token - Token de download.
 * @param {string} user - Nome de usuário do peer.
 * @param {boolean} noPierce - Se a conexão deve ser iniciada sem tentativa de hole punching.
 * @returns {void}
 */
module.exports = (host, port, token, user, noPierce) => {
  debug(`downloadPeerFile ${user}`)
  let conn = net.createConnection({
    host,
    port
  }, () => {
    if (noPierce) {
      debug(`noPierce ${user} connected`)
      conn.write(MessageFactory
        .to.peer
        .peerInit(stack.currentLogin, 'F', token)
        .getBuff())

      setTimeout(() => {
        debug(`noPierce sending 8* 00`)
        if (conn.destroyed) {
          debug(`socket closed`)
          return
        }
        conn.write(Buffer.from('00000000' + '00000000', 'hex'))
      }, 1000)
    } else {
      conn.write(MessageFactory
        .to.peer
        .pierceFw(token)
        .getBuff())
    }
  })

  let received = false
  let requestToken = noPierce ? token : undefined
  let buf = Buffer.alloc(0)
  let tok
  let down
  let i = 0

  conn.on('data', data => {
    if (!noPierce && !received) {
      // No modo pierce, o primeiro pacote contém o token de requisição
      requestToken = data.toString('hex', 0, 4)
      conn.write(Buffer.from('00000000' + '00000000', 'hex'))
      received = true
    } else {
      debug(`file data`)
      // Se houver um stream definido (por exemplo, Readable stream para pipe), continua a enviar
      if (down && down.stream) {
        debug('push to stream')
        down.stream.push(data)
      }
      // Acumula todos os chunks no buffer
      buf = Buffer.concat([buf, data])
    }

    if (tok) {
      if (i % 10 === 0) {
        debug(`buf: ${buf.length} size: ${tok.size}`)
      }
      i++
    } else {
      // Procura o token e a informação de download no 'stack'
      tok = stack.downloadTokens[requestToken]
      down = stack.download[tok.user + '_' + tok.file]
    }

    // Se o tamanho do buffer atingir o tamanho esperado do arquivo, encerra a conexão
    if (tok && buf.length >= tok.size) {
      debug(`disconnect, buf: ${buf.length} size: ${tok.size}`)
      conn.end()
    }
  })

  conn.on('close', () => {
    debug(`file socket close ${user}`)
    if (tok && down) {
      // Sinaliza o fim do stream (se houver)
      if (down.stream) down.stream.push(null)

      // **A MODIFICAÇÃO CHAVE AQUI:**
      // Removemos o fs.writeFile e chamamos o callback diretamente
      down.buffer = buf
      if (typeof down.cb === 'function') down.cb(null, down)
    } else {
      // Caso de erro: token não existe
      debug(`ERROR: token ${token} not exist. Buffer size: ${buf.length}`)
      // Se houvesse um mecanismo de erro no 'down.cb', ele seria chamado aqui.
    }
  })

  conn.on('error', (err) => {
    debug(`file socket error ${user}, destroying: ${err.message}`)
    conn.destroy()
    // O evento 'close' será chamado após o 'destroy'
    if (tok && down && typeof down.cb === 'function') {
      down.cb(new Error(`Connection error during download: ${err.message}`), null)
    }
  })
}

// Removida a função getFilePathName pois não é mais utilizada.
