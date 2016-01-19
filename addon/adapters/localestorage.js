import Adapter from 'ember-data/adapter';
import Ember from "ember";

const {
 RSVP,
 copy,
 get
} = Ember;

export default Adapter.extend({
  findRecord: function(store, type, id, opts) {
    var allowRecursive = true;
    var namespace = this._namespaceForType(type);
    var record = Ember.A(namespace.records[id]);

    /**
     * In the case where there are relationships, this method is called again
     * for each relation. Given the relations have references to the main
     * object, we use allowRecursive to avoid going further into infinite
     * recursiveness.
     *
     * Concept from ember-indexdb-adapter
     */
    if (opts && typeof opts.allowRecursive !== 'undefined') {
      allowRecursive = opts.allowRecursive;
    }

    if (!record || !record.hasOwnProperty('id')) {
      return RSVP.reject(new Error("Couldn't find record of"
                                         + " type '" + type.modelName
                                         + "' for the id '" + id + "'."));
    }

    if (allowRecursive) {
      return this.loadRelationships(store, type, record);
    } else {
      return RSVP.resolve(record);
    }
  },
  findMany: function (store, type, ids, opts) {
      var namespace = this._namespaceForType(type);
      var adapter = this,
          allowRecursive = true,
          results = [], record;

      /**
       * In the case where there are relationships, this method is called again
       * for each relation. Given the relations have references to the main
       * object, we use allowRecursive to avoid going further into infinite
       * recursiveness.
       *
       * Concept from ember-indexdb-adapter
       */
      if (opts && typeof opts.allowRecursive !== 'undefined') {
        allowRecursive = opts.allowRecursive;
      }

      for (var i = 0; i < ids.length; i++) {
        record = namespace.records[ids[i]];
        if (!record || !record.hasOwnProperty('id')) {
          return.RSVP.reject(new Error("Couldn't find record of type '" + type.modelName
                                             + "' for the id '" + ids[i] + "'."));
        }
        results.push(copy(record));
      }

      if (results.get('length') && allowRecursive) {
        return this.loadRelationshipsForMany(store, type, results);
      } else {
        return RSVP.resolve(results);
      }
    },
    findQuery: function (store, type, query, recordArray) {
      Ember.deprecate('JSONAdapter#findQuery has been deprecated and renamed to `query`.');
      this.query(store, type, query);
    },

    _resultDict: function(records, query) {
      var results = [], record,
          _this = this;
      for (var id in records) {
          record = records[id];
          if (_this._recordMatchedQuery(record, query)) {
            results.push(Ember.copy(record));
          }
      }
      return results;
    },
    _recordMatchedQuery: function(record, query) {
      return Object.keys(query).every(function(property) {
          let test = query[property];
          if(Object.prototype.toString.call(test) === '[object RegExp]') {
              return test.test(record[property]);
          } else {
              return record[property] === test;
          }
      });
    },

    query: function(store, type, query, recordArray) {
      let namespace = this._namespaceForType(type),
          results = this._resultDict(namespace.records, query);

      if (results.get('length')) {
          return this.loadRelationshipsForMany(store, type, results);
        } else {
          return RSVP.reject();
        }
        return results;
    },

    findAll: function (store, type) {
      let namespace = this._namespaceForType(type),
          results = [];

      for (var id in namespace.records) {
        results.push(copy(namespace.records[id]));
      }
      return RSVP.resolve(results);
  },
  createRecord: function (store, type, snapshot) {
    let namespaceRecords = this._namespaceForType(type),
        serializer = store.serializerFor(type.modelName),
        recordHash = serializer.serialize(snapshot, {includeId: true});

    namespaceRecords.records[recordHash.id] = recordHash;

    this.persistData(type, namespaceRecords);
    return RSVP.resolve();
  },

  updateRecord: function (store, type, snapshot) {
    let namespaceRecords = this._namespaceForType(type),
        serializer = store.serializerFor(type.modelName),
        id = snapshot.id;

    namespaceRecords.records[id] = serializer.serialize(snapshot, { includeId: true });

    this.persistData(type, namespaceRecords);
    return RSVP.resolve();
  },
  deleteRecord: function (store, type, snapshot) {
    var namespaceRecords = this._namespaceForType(type),
        id = snapshot.id;

    delete namespaceRecords.records[id];

    this.persistData(type, namespaceRecords);
    return RSVP.resolve();
  },
  generateIdForRecord: function () {
    return Math.random().toString(32).slice(2).substr(0, 5);
  },
  adapterNamespace: function () {
    return this.get('namespace') || 'DS.LSAdapter';
  },

  loadData: function () {
    var storage = this.getLocalStorage().getItem(this.adapterNamespace());
    return storage ? JSON.parse(storage) : {};
  },
  persistData: function(type, data) {
    var modelNamespace = this.modelNamespace(type),
        localStorageData = this.loadData();

    localStorageData[modelNamespace] = data;

    this.getLocalStorage().setItem(this.adapterNamespace(), JSON.stringify(localStorageData));
  },

  getLocalStorage: function() {
    if (this._localStorage) { return this._localStorage; }

    var storage;
    try {
      storage = this.getNativeStorage() || this._enableInMemoryStorage();
    } catch (e) {
      storage = this._enableInMemoryStorage(e);
    }

    return this._localStorage = storage;
  },
  _enableInMemoryStorage: function(reason) {
    this.trigger('persistenceUnavailable', reason);
    return {
      storage: {},
      getItem: function(name) {
        return this.storage[name];
      },
      setItem: function(name, value) {
        this.storage[name] = value;
      }
    };
  },
  // This exists primarily as a testing extension point
  getNativeStorage: function() {
      return localStorage;
  },
  _namespaceForType: function (type) {
    var namespace = this.modelNamespace(type);
    var storage   = this.loadData();

    return storage[namespace] || {records: {}};
  },
  modelNamespace: function(type) {
    return type.url || type.modelName;
  },
  loadRelationships: function(store, type, record) {
    let adapter = this,
        resultJSON = {},
        modelName = type.modelName,
        relationshipNames, relationships,
        relationshipPromises = [];

    /**
     * Create a chain of promises, so the relationships are
     * loaded sequentially.  Think of the variable
     * `recordPromise` as of the accumulator in a left fold.
     */
    var recordPromise = RSVP.resolve(record);

    relationshipNames = get(type, 'relationshipNames');
    relationships = relationshipNames.belongsTo
      .concat(relationshipNames.hasMany);

    relationships.forEach(function(relationName) {
      var relationModel = type.typeForRelationship(relationName, store);
      var relationEmbeddedId = record[relationName];
      var relationProp  = adapter.relationshipProperties(type, relationName);
      var relationType  = relationProp.kind;
      var foreignAdapter = store.adapterFor(relationName.modelName);

      var opts = {allowRecursive: false};

      /**
       * embeddedIds are ids of relations that are included in the main
       * payload, such as:
       *
       * {
       *    cart: {
       *      id: "s85fb",
       *      customer: "rld9u"
       *    }
       * }
       *
       * In this case, cart belongsTo customer and its id is present in the
       * main payload. We find each of these records and add them to _embedded.
       */
      if (relationEmbeddedId && foreignAdapter === adapter)
      {
        recordPromise = recordPromise.then(function(recordPayload) {
          var promise;
          if (relationType === 'belongsTo' || relationType === 'hasOne') {
            promise = adapter.findRecord(null, relationModel, relationEmbeddedId, opts);
          } else if (relationType == 'hasMany') {
            promise = adapter.findMany(null, relationModel, relationEmbeddedId, opts);
          }

          return promise.then(function(relationRecord) {
            return adapter.addEmbeddedPayload(recordPayload, relationName, relationRecord);
          });
        });
      }
    });

    return recordPromise;
  },
  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    let objectHasId = (relationshipRecord && relationshipRecord.id),
        arrayHasIds = (relationshipRecord.length && relationshipRecord.isEvery("id")),
        isValidRelationship = (objectHasId || arrayHasIds);

    if (isValidRelationship) {
      if (!payload['_embedded']) {
        payload['_embedded'] = {};
      }

      payload['_embedded'][relationshipName] = relationshipRecord;
      if (relationshipRecord.length) {
        payload[relationshipName] = relationshipRecord.mapBy('id');
      } else {
        payload[relationshipName] = relationshipRecord.id;
      }
    }

    if (this.isArray(payload[relationshipName])) {
      payload[relationshipName] = payload[relationshipName].filter(function(id) {
        return id;
      });
    }

    return payload;
  },
  isArray: function(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  },
  loadRelationshipsForMany: function(store, type, recordsArray) {
    let adapter = this,
        promise = RSVP.resolve([]);

    /**
     * Create a chain of promises, so the records are loaded sequentially.
     * Think of the variable promise as of the accumulator in a left fold.
     */
    recordsArray.forEach(function(record) {
      promise = promise.then(function(records) {
        return adapter.loadRelationships(store, type, record)
          .then(function(loadedRecord) {
            records.push(loadedRecord);
            return records;
          });
      });
    });

    return promise;
  },


  /**
   *
   * @method relationshipProperties
   * @private
   * @param {DS.Model} type
   * @param {String} relationName
   */
  relationshipProperties: function(type, relationName) {
    let relationships = get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  }
});
