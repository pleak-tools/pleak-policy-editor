import { Component, OnInit, Input, ViewChild } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SqlBPMNModdle } from './bpmn-labels-extension';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

import { ElementsHandler } from './elements-handler';
import { HttpClient, HttpResponse } from '@angular/common/http';

declare let $: any;
declare function require(name: string);
const is = (element, type) => element.$instanceOf(type);

const pg_parser = require('exports-loader?Module!pgparser/pg_query.js');
const config = require('../../config.json');

@Component({
  selector: 'app-guessing-advantage-editor',
  templateUrl: 'editor.component.html',
  styleUrls: ['editor.component.less']
})
export class EditorComponent implements OnInit {

  constructor(public http: HttpClient, private authService: AuthService) {
    const pathname = window.location.pathname.split('/');
    if (pathname[2] === 'viewer') {
      this.modelId = pathname[3];
      this.viewerType = 'public';
    } else {
      this.modelId = pathname[2];
      this.viewerType = 'private';
    }
    this.authService.authStatus.subscribe(status => {
      this.authenticated = status;
      if (typeof (status) === 'boolean') {
        this.getModel();
      }
    });
    this.getModel();
  }

  @Input() authenticated: Boolean;

  @ViewChild('scriptModal', { static: false }) scriptModal: any;

  public loaded = false;

  private viewer: NavigatedViewer;

  modelId;
  viewerType;

  private changesInModel = true;
  private lastContent: String = '';

  private fileId: Number = null;
  private file: any;

  private lastModified: Number = null;

  elementsHandler: any;

  isAuthenticated() {
    return this.authenticated;
  }

  isLoaded() {
    return this.loaded;
  }

  getChangesInModelStatus() {
    return this.changesInModel;
  }

  setChangesInModelStatus(status: boolean) {
    this.changesInModel = status;
  }

  // Load model
  getModel() {
    const self = this;
    $('#canvas').html('');
    $('.buttons-container').off('click', '#save-diagram');
    self.viewer = null;
    this.http.get(config.backend.host + '/rest/directories/files/' + (this.viewerType === 'public' ? 'public/' : '') + this.modelId, AuthService.loadRequestOptions()).subscribe(
      success => {
        self.file = success;
        self.fileId = self.file.id;
        if (self.file.content.length === 0) {
          console.log('File cannot be found or opened!');
        }
        if (this.viewerType === 'public' && this.isAuthenticated()) {
          self.getPermissions();
        } else {
          self.openDiagram(self.file.content);
        }
        self.lastContent = self.file.content;
        document.title = 'Pleak guessing advantage editor - ' + self.file.title;
        $('#fileName').text(this.file.title);
        self.lastModified = new Date().getTime();
      },
      () => {
        self.fileId = null;
        self.file = null;
        self.lastContent = '';
      }
    );
  }

  getPermissions() {
    const self = this;
    this.http.get(config.backend.host + '/rest/directories/files/' + this.fileId, AuthService.loadRequestOptions()).subscribe(
      (response: any) => {
        this.file.permissions = response.permissions;
        this.file.user = response.user;
        this.file.md5Hash = response.md5Hash;
      },
      () => { },
      () => {
        self.openDiagram(self.file.content);
      }
    );
  }


  // Load diagram and add editor
  openDiagram(diagram: String) {
    if (diagram && this.viewer == null) {
      this.viewer = new NavigatedViewer({
        container: '#canvas',
        keyboard: {
          bindTo: document
        },
        moddleExtensions: {
          sqlExt: SqlBPMNModdle
        }
      });

      const elementsHandler = new ElementsHandler(this.viewer, diagram, pg_parser, this, this.canEdit());
      this.elementsHandler = elementsHandler;

      this.addEventHandlers(elementsHandler);
    }
  }

  canEdit() {
    const file = this.file;

    if (!file || !this.isAuthenticated()) { return false; }
    if ((this.authService.user && file.user) ? file.user.email === this.authService.user.email : false) { return true; }
    for (let pIx = 0; pIx < file.permissions.length; pIx++) {
      if (file.permissions[pIx].action.title === 'edit' &&
        this.authService.user ? file.permissions[pIx].user.email === this.authService.user.email : false) {
        return true;
      }
    }
    return false;
  }

  addEventHandlers(elementsHandler) {
    this.removeEventHandlers();
    $('.buttons-container').on('click', '.buttons a', (e) => {
      if (!$(e.target).is('.active')) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    $('.buttons-container').on('click', '#save-diagram', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.save();
    });

    $(document).on('click', '#analyze-diagram', (e) => {
      e.preventDefault();
      e.stopPropagation();
      elementsHandler.analysisHandler.loadAnalysisPanelTemplate();
    });

    $(window).on('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (String.fromCharCode(e.which).toLowerCase()) {
          case 's':
            if ($('#save-diagram').is('.active')) {
              event.preventDefault();
              this.save();
            }
            break;
        }
      }
    });

    $(window).bind('beforeunload', (e) => {
      if (this.file.content != this.lastContent || elementsHandler.areThereUnsavedChangesOnModel()) {
        return 'Are you sure you want to close this tab? Unsaved progress will be lost.';
      }
    });

    $(window).on('wheel', (event) => {
      // Change the color of stereotype labels more visible when zooming out
      const zoomLevel = this.viewer.get('canvas').zoom();
      if (zoomLevel < 1.0) {
        if ($('.stereotype-label-color').css('color') != 'rgb(0, 0, 255)') {
          $('.stereotype-label-color').css('color', 'blue');
        }
      } else {
        if ($('.stereotype-label-color').css('color') != 'rgb(0, 0, 139)') {
          $('.stereotype-label-color').css('color', 'darkblue');
        }
      }
    });

    // $(document).off('click', '#propagate-diagram');
    $(document).on('click', '#propagate-diagram', (e) => {
      e.preventDefault();
      e.stopPropagation();
      elementsHandler.propagationHandler.initPropagation();
    });

    $(window).resize(() => {
      $('#resize-buttons-container').width($('#sidebar').width());
    });

    $('#resize-inc').on('click', () => {
      if ($('#sidebar').width() < 0.4 * window.innerWidth) {
        $('#sidebar').width($('#sidebar').width() * 1.3);
      }
      this.loadResizeButtonsMode();
    });

    $('#resize-dec').on('click', () => {
      if ($('#sidebar').width() > 250) {
        if (($('#sidebar').width() / 1.3) < 250) {
          $('#sidebar').width(250);
        } else {
          $('#sidebar').width($('#sidebar').width() / 1.3);
        }
      }
      this.loadResizeButtonsMode();
    });

    this.loadResizeButtonsMode();

  }

  removeEventHandlers() {
    $('.buttons-container').off('click', '.buttons a');
    $('.buttons-container').off('click', '#save-diagram');
    $('.buttons-container').off('click', '#analyze-diagram');
    $(window).off('keydown');
    $(window).unbind('beforeunload');
    $(window).off('wheel');
  }

  // Save model
  save() {
    const self = this;
    if ($('#save-diagram').is('.active')) {
      this.viewer.saveXML(
        {
          format: true
        },
        (err: any, xml: string) => {
          if (err) {
            console.log(err);
          } else {
            self.file.content = xml;
            this.http.put(config.backend.host + '/rest/directories/files/' + self.fileId, self.file, AuthService.loadRequestOptions({ observe: 'response' })).subscribe(
              (response: HttpResponse<any>) => {
                if (response.status === 200 || response.status === 201) {
                  const data = response.body;
                  $('#fileSaveSuccess').show();
                  $('#fileSaveSuccess').fadeOut(5000);
                  $('#save-diagram').removeClass('active');
                  const date = new Date();
                  self.lastModified = date.getTime();
                  localStorage.setItem('lastModifiedFileId', '"' + data.id + '"');
                  localStorage.setItem('lastModified', '"' + date.getTime() + '"');
                  if (self.fileId !== data.id) {
                    window.location.href = config.frontend.host + '/modeler/' + data.id;
                  }
                  self.file.md5Hash = data.md5Hash;
                  self.lastContent = self.file.content;
                  self.fileId = data.id;
                  self.setChangesInModelStatus(true);
                } else if (response.status === 401) {
                  $('#loginModal').modal();
                }
              },
              fail => {
              }
            );
          }
        });
    }
  }

  updateModelContentVariable(xml: String) {
    if (xml) {
      this.file.content = xml;
      if (this.file.content != this.lastContent) {
        this.setChangesInModelStatus(true);
        $('#save-diagram').addClass('active');
      }
    }
  }

  loadResizeButtonsMode(): void {
    if ($('#sidebar').width() <= 250) {
      $('#resize-dec').prop('disabled', true);
    } else {
      $('#resize-dec').prop('disabled', false);
    }

    if ($('#sidebar').width() >= 0.4 * window.innerWidth) {
      $('#resize-inc').prop('disabled', true);
    } else {
      $('#resize-inc').prop('disabled', false);
    }
    $("#resize-buttons-container").css('width', $('#sidebar').width());
  }

  initExportButton(): void {
    this.loadExportButton();
    $(document).off('click', '#download-diagram');
    $(document).on('click', '#download-diagram', (e) => {
      this.loadExportButton();
    });

  }

  loadExportButton(): void {
    this.viewer.saveXML(
      {
        format: true
      },
      (err: any, xml: string) => {
        let encodedData = encodeURIComponent(xml);
        if (xml) {
          $('#download-diagram-container').removeClass('hidden');
          $('#download-diagram').addClass('active').attr({
            'href': 'data:application/bpmn20-xml;charset=UTF-8,' + encodedData,
            'download': $('#fileName').text()
          });
        }
      }
    );
  }

  ngOnInit() {
    window.addEventListener('storage', (e) => {
      if (e.storageArea === localStorage) {
        if (!this.authService.verifyToken()) {
          this.getModel();
        } else {
          const lastModifiedFileId = Number(localStorage.getItem('lastModifiedFileId').replace(/['"]+/g, ''));
          let currentFileId = null;
          if (this.file) {
            currentFileId = this.file.id;
          }
          const localStorageLastModifiedTime = Number(localStorage.getItem('lastModified').replace(/['"]+/g, ''));
          const lastModifiedTime = this.lastModified;
          if (lastModifiedFileId && currentFileId && localStorageLastModifiedTime && lastModifiedTime && lastModifiedFileId === currentFileId && localStorageLastModifiedTime > lastModifiedTime) {
            this.getModel();
          }
        }
      }
    });
  }

  openScriptModal(script: string, name: string, type: string, elementId: string): void {
    this.scriptModal.openModal(JSON.stringify({ name: name, value: script, type: type, id: elementId }));
  }

  setScript(scriptObj: any): void {
    let info = JSON.parse(scriptObj);
    if (info) {
      if (info.type == "task") {
        let taskHandler = this.elementsHandler.getTaskHandlerByTaskId(info.id);
        if (taskHandler) {
          taskHandler.setSQLScriptValue(info.value);
        }
      } else if (info.type == "do") {
        let doHandler = this.elementsHandler.getDataObjectHandlerByDataObjectId(info.id);
        if (doHandler) {
          doHandler.setSchemaInputValue(info.value);
        }
      }
    }
  }

  saveScript(scriptObj: string): void {
    let info = JSON.parse(scriptObj);
    if (info.type == "task") {
      let taskHandler = this.elementsHandler.getTaskHandlerByTaskId(info.id);
      if (taskHandler) {
        taskHandler.saveTaskOptions();
      }
    } else if (info.type == "do") {
      let doHandler = this.elementsHandler.getDataObjectHandlerByDataObjectId(info.id);
      if (doHandler) {
        doHandler.saveDataObjectOptions();
      }
    }
  }

}
