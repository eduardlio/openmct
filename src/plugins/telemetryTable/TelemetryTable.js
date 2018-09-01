/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2018, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define([
    'EventEmitter',
    'lodash',
    './collections/BoundedTableRowCollection',
    './collections/FilteredTableRowCollection',
    './TelemetryTableRow',
    './TelemetryTableConfiguration'
], function (
    EventEmitter,
    _,
    BoundedTableRowCollection,
    FilteredTableRowCollection,
    TelemetryTableRow,
    TelemetryTableConfiguration
) {
    class TelemetryTable extends EventEmitter {
        constructor(domainObject, rowCount, openmct) {
            super();

            this.domainObject = domainObject;
            this.openmct = openmct;
            this.rowCount = rowCount;
            this.subscriptions = {};
            this.tableComposition = undefined;
            this.telemetryObjects = [];
            this.outstandingRequests = 0;
            this.configuration = new TelemetryTableConfiguration(domainObject, openmct);

            this.addTelemetryObject = this.addTelemetryObject.bind(this);
            this.removeTelemetryObject = this.removeTelemetryObject.bind(this);
            this.isTelemetryObject = this.isTelemetryObject.bind(this);
            this.refreshData = this.refreshData.bind(this);
            this.requestDataFor = this.requestDataFor.bind(this);

            this.createTableRowCollections();
            openmct.time.on('bounds', this.refreshData);
        }

        initialize() {
            if (this.domainObject.type === 'table') {
                this.loadComposition();
            } else {
                this.addTelemetryObject(this.domainObject);
            }
        }

        createTableRowCollections() {
            this.boundedRows = new BoundedTableRowCollection(this.openmct);

            //By default, sort by current time system, ascending.
            this.filteredRows = new FilteredTableRowCollection(this.boundedRows);
            this.filteredRows.sortBy({
                key: this.openmct.time.timeSystem().key,
                direction: 'asc'
            });
        }

        loadComposition() {
            this.tableComposition = this.openmct.composition.get(this.domainObject);
            if (this.tableComposition !== undefined){
                this.tableComposition.load().then((composition)=>{
                    composition = composition.filter(this.isTelemetryObject);

                    this.configuration.addColumnsForAllObjects(composition);
                    composition.forEach(this.addTelemetryObject);
    
                    this.tableComposition.on('add', this.addTelemetryObject);
                    this.tableComposition.on('remove', this.removeTelemetryObject);
                });    
            }
        }

        addTelemetryObject(telemetryObject) {
            this.configuration.addColumnsForObject(telemetryObject, true);
            this.requestDataFor(telemetryObject);
            this.subscribeTo(telemetryObject);
            this.telemetryObjects.push(telemetryObject);

            this.emit('object-added', telemetryObject);
        }

        removeTelemetryObject(objectIdentifier) {
            this.configuration.removeColumnsForObject(objectIdentifier, true);
            let keyString = this.openmct.objects.makeKeyString(objectIdentifier);
            this.boundedRows.removeAllRowsForObject(keyString);
            this.unsubscribe(keyString);
            this.telemetryObjects = this.telemetryObjects.filter((object) => !_.eq(objectIdentifier, object.identifier));

            this.emit('object-removed', objectIdentifier);
        }

        requestDataFor(telemetryObject) {
            this.incrementOutstandingRequests();

            return this.openmct.telemetry.request(telemetryObject)
                .then(telemetryData => {
                    let keyString = this.openmct.objects.makeKeyString(telemetryObject.identifier);
                    let columnMap = this.getColumnMapForObject(keyString);
                    let limitEvaluator = this.openmct.telemetry.limitEvaluator(telemetryObject);

                    let telemetryRows = telemetryData.map(datum => new TelemetryTableRow(datum, columnMap, keyString, limitEvaluator));
                    this.boundedRows.add(telemetryRows);
                    this.decrementOutstandingRequests();
                });
        }

        /**
         * @private
         */
        incrementOutstandingRequests() {
            if (this.outstandingRequests === 0){
                this.emit('outstanding-requests', true);
            }
            this.outstandingRequests++;
        }

        /**
         * @private
         */
        decrementOutstandingRequests() {
            this.outstandingRequests--;

            if (this.outstandingRequests === 0){
                this.emit('outstanding-requests', false);
            }
        }

        refreshData(bounds, isTick) {
            if (!isTick) {
                this.filteredRows.clear();
                this.boundedRows.clear();
                this.telemetryObjects.forEach(this.requestDataFor);
            }
        }

        getColumnMapForObject(objectKeyString) {
            let columns = this.configuration.getColumns();
            
            return columns[objectKeyString].reduce((map, column) => {
                map[column.getKey()] = column;
                return map;
            }, {});
        }

        subscribeTo(telemetryObject) {
            let keyString = this.openmct.objects.makeKeyString(telemetryObject.identifier);
            let columnMap = this.getColumnMapForObject(keyString);
            let limitEvaluator = this.openmct.telemetry.limitEvaluator(telemetryObject);

            this.subscriptions[keyString] = this.openmct.telemetry.subscribe(telemetryObject, (datum) => {
                this.boundedRows.add(new TelemetryTableRow(datum, columnMap, keyString, limitEvaluator));
            });
        }

        isTelemetryObject(domainObject) {
            return domainObject.hasOwnProperty('telemetry');
        }

        unsubscribe(keyString) {
            this.subscriptions[keyString]();
            delete this.subscriptions[keyString];
        }

        destroy() {
            this.boundedRows.destroy();
            this.filteredRows.destroy();
            Object.keys(this.subscriptions).forEach(this.unsubscribe, this);
            this.openmct.time.off('bounds', this.refreshData);
            
            if (this.tableComposition !== undefined) {
                this.tableComposition.off('add', this.addTelemetryObject);
                this.tableComposition.off('remove', this.removeTelemetryObject);
            }
        }
    }

    return TelemetryTable;
});